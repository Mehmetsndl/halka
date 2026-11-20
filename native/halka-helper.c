/*
 * halka-helper.exe — tiny Win32 companion process for Halka.
 *
 * Halka's Electron main process keeps one helper running and talks to it over
 * stdin/stdout, one request per line:  "<id> <command> [argument]\n"
 * Each reply is one line:              "<id> <json>\n"
 *
 * Commands
 *   fg                 foreground window: {"hwnd":N,"cls":"…","title":"…"}
 *   focus <hwnd>       bring a window back to the front
 *   waitmods <ms>      wait until Ctrl/Alt/Shift/Win are released
 *   paste | copy       send Ctrl+V / Ctrl+C with SendInput
 *   seq                GetClipboardSequenceNumber()
 *   private            1 when the clipboard owner asked to stay out of history
 *   explorer <hwnd>    selected paths in that Explorer window (active tab)
 *   desktop            selected paths on the desktop
 *   hasimage           1 when the clipboard holds PNG or bitmap data
 *   clipimage <path>   save the clipboard image (PNG, or CF_DIB as BMP) to a file
 *   ping
 *
 * Build: x86_64-w64-mingw32-gcc -O2 -municode -mconsole -o halka-helper.exe halka-helper.c -lole32 -loleaut32 -luuid -lshell32
 */
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <exdisp.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlguid.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

static char out[1 << 16];
static size_t outLen;

static void put(const char *s) {
    size_t n = strlen(s);
    if (outLen + n >= sizeof(out) - 4) return;
    memcpy(out + outLen, s, n);
    outLen += n;
}

static void putWide(const wchar_t *w) {
    char buf[4096];
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, buf, sizeof(buf), NULL, NULL);
    if (n <= 0) return;
    put("\"");
    for (const unsigned char *p = (const unsigned char *)buf; *p; p++) {
        char esc[8];
        if (*p == '"' || *p == '\\') { esc[0] = '\\'; esc[1] = (char)*p; esc[2] = 0; put(esc); }
        else if (*p < 0x20) { snprintf(esc, sizeof esc, "\\u%04x", *p); put(esc); }
        else { esc[0] = (char)*p; esc[1] = 0; put(esc); }
    }
    put("\"");
}

static void reply(const char *id) {
    fwrite(id, 1, strlen(id), stdout);
    fputc(' ', stdout);
    fwrite(out, 1, outLen, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static int modsDown(void) {
    const int keys[] = { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN };
    for (int i = 0; i < 5; i++) if (GetAsyncKeyState(keys[i]) & 0x8000) return 1;
    return 0;
}

static void key(WORD vk, int up) {
    INPUT in = {0};
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    SendInput(1, &in, sizeof(INPUT));
}

static void chord(WORD vk) {
    /* Release modifiers the user may still be holding so Ctrl+V doesn't become Ctrl+Alt+V. */
    const WORD stray[] = { VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN };
    for (int i = 0; i < 4; i++) if (GetAsyncKeyState(stray[i]) & 0x8000) key(stray[i], 1);
    INPUT in[4] = {0};
    for (int i = 0; i < 4; i++) in[i].type = INPUT_KEYBOARD;
    in[0].ki.wVk = VK_CONTROL;
    in[1].ki.wVk = vk;
    in[2].ki.wVk = vk; in[2].ki.dwFlags = KEYEVENTF_KEYUP;
    in[3].ki.wVk = VK_CONTROL; in[3].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(4, in, sizeof(INPUT));
}

static int focusWindow(HWND hwnd) {
    if (!IsWindow(hwnd)) return 0;
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
    HWND current = GetForegroundWindow();
    if (current == hwnd) return 1;
    DWORD self = GetCurrentThreadId();
    DWORD other = current ? GetWindowThreadProcessId(current, NULL) : 0;
    BOOL attached = (other && other != self) ? AttachThreadInput(self, other, TRUE) : FALSE;
    BOOL ok = SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    if (attached) AttachThreadInput(self, other, FALSE);
    if (!ok) {
        /* A lone Alt tap lifts the foreground lock when Windows refuses the switch. */
        key(VK_MENU, 0);
        key(VK_MENU, 1);
        ok = SetForegroundWindow(hwnd);
    }
    return ok ? 1 : 0;
}

static int hasFormat(const wchar_t *name) {
    UINT format = RegisterClipboardFormatW(name);
    return format && IsClipboardFormatAvailable(format);
}

static int clipboardPrivate(void) {
    if (hasFormat(L"ExcludeClipboardContentFromMonitorProcessing")) return 1;
    if (hasFormat(L"Clipboard Viewer Ignore")) return 1;
    UINT history = RegisterClipboardFormatW(L"CanIncludeInClipboardHistory");
    int blocked = 0;
    if (history && IsClipboardFormatAvailable(history)) {
        for (int attempt = 0; attempt < 5 && !blocked; attempt++) {
            if (OpenClipboard(NULL)) {
                HANDLE data = GetClipboardData(history);
                if (data) {
                    DWORD *value = (DWORD *)GlobalLock(data);
                    if (value && GlobalSize(data) >= sizeof(DWORD) && *value == 0) blocked = 1;
                    if (value) GlobalUnlock(data);
                }
                CloseClipboard();
                break;
            }
            Sleep(10);
        }
    }
    return blocked;
}

/* Saves the clipboard image to `path`: the registered "PNG" format when present,
 * otherwise CF_DIB wrapped in a BMP file header. Returns "png", "bmp" or NULL. */
static FILE *openUtf8(const char *path) {
    wchar_t wide[1024];
    if (!MultiByteToWideChar(CP_UTF8, 0, path, -1, wide, 1024)) return NULL;
    return _wfopen(wide, L"wb");
}

static const char *saveClipboardImage(const char *path) {
    const char *kind = NULL;
    UINT png = RegisterClipboardFormatW(L"PNG");
    for (int attempt = 0; attempt < 10; attempt++) {
        if (OpenClipboard(NULL)) break;
        if (attempt == 9) return NULL;
        Sleep(15);
    }
    HANDLE data = NULL;
    if (png && IsClipboardFormatAvailable(png) && (data = GetClipboardData(png))) {
        const void *bytes = GlobalLock(data);
        SIZE_T size = GlobalSize(data);
        if (bytes && size > 8) {
            FILE *f = openUtf8(path);
            if (f) { fwrite(bytes, 1, size, f); fclose(f); kind = "png"; }
        }
        if (bytes) GlobalUnlock(data);
    } else if (IsClipboardFormatAvailable(CF_DIB) && (data = GetClipboardData(CF_DIB))) {
        const BITMAPINFOHEADER *info = (const BITMAPINFOHEADER *)GlobalLock(data);
        SIZE_T size = GlobalSize(data);
        if (info && size >= sizeof(BITMAPINFOHEADER)) {
            DWORD colors = info->biClrUsed ? info->biClrUsed : (info->biBitCount <= 8 ? (1u << info->biBitCount) : 0);
            DWORD masks = (info->biCompression == BI_BITFIELDS && info->biSize == sizeof(BITMAPINFOHEADER)) ? 12 : 0;
            BITMAPFILEHEADER header = {0};
            header.bfType = 0x4D42;
            header.bfSize = (DWORD)(sizeof(BITMAPFILEHEADER) + size);
            header.bfOffBits = (DWORD)(sizeof(BITMAPFILEHEADER) + info->biSize + masks + colors * 4);
            FILE *f = openUtf8(path);
            if (f) { fwrite(&header, 1, sizeof header, f); fwrite(info, 1, size, f); fclose(f); kind = "bmp"; }
        }
        if (info) GlobalUnlock(data);
    }
    CloseClipboard();
    return kind;
}

/* --------------------------------------------------------------- Explorer */

static void putSelection(IShellBrowser *browser) {
    IShellView *view = NULL;
    IFolderView *folder = NULL;
    IShellItemArray *items = NULL;
    int first = 1;
    put("[");
    if (SUCCEEDED(IShellBrowser_QueryActiveShellView(browser, &view)) && view) {
        if (SUCCEEDED(IShellView_QueryInterface(view, &IID_IFolderView, (void **)&folder)) && folder) {
            if (SUCCEEDED(IFolderView_Items(folder, SVGIO_SELECTION, &IID_IShellItemArray, (void **)&items)) && items) {
                DWORD count = 0;
                IShellItemArray_GetCount(items, &count);
                for (DWORD i = 0; i < count && i < 2000; i++) {
                    IShellItem *item = NULL;
                    if (FAILED(IShellItemArray_GetItemAt(items, i, &item)) || !item) continue;
                    wchar_t *path = NULL;
                    if (SUCCEEDED(IShellItem_GetDisplayName(item, SIGDN_FILESYSPATH, &path)) && path) {
                        if (!first) put(",");
                        putWide(path);
                        first = 0;
                        CoTaskMemFree(path);
                    }
                    IShellItem_Release(item);
                }
                IShellItemArray_Release(items);
            }
            IFolderView_Release(folder);
        }
        IShellView_Release(view);
    }
    put("]");
}

static IShellBrowser *browserOf(IDispatch *dispatch) {
    IServiceProvider *provider = NULL;
    IShellBrowser *browser = NULL;
    if (SUCCEEDED(IDispatch_QueryInterface(dispatch, &IID_IServiceProvider, (void **)&provider)) && provider) {
        IServiceProvider_QueryService(provider, &SID_STopLevelBrowser, &IID_IShellBrowser, (void **)&browser);
        IServiceProvider_Release(provider);
    }
    return browser;
}

static void explorerSelection(HWND target) {
    IShellWindows *windows = NULL;
    put("{\"paths\":");
    if (FAILED(CoCreateInstance(&CLSID_ShellWindows, NULL, CLSCTX_ALL, &IID_IShellWindows, (void **)&windows)) || !windows) {
        put("[]}");
        return;
    }
    /* Windows 11 tabs share one top-level HWND; the first ShellTabWindowClass child is the active tab. */
    HWND activeTab = FindWindowExW(target, NULL, L"ShellTabWindowClass", NULL);
    IShellBrowser *fallback = NULL;
    IShellBrowser *chosen = NULL;
    long count = 0;
    IShellWindows_get_Count(windows, &count);
    for (long i = 0; i < count && !chosen; i++) {
        VARIANT index;
        VariantInit(&index);
        index.vt = VT_I4;
        index.lVal = i;
        IDispatch *dispatch = NULL;
        if (FAILED(IShellWindows_Item(windows, index, &dispatch)) || !dispatch) continue;
        IWebBrowserApp *app = NULL;
        if (SUCCEEDED(IDispatch_QueryInterface(dispatch, &IID_IWebBrowserApp, (void **)&app)) && app) {
            SHANDLE_PTR handle = 0;
            if (SUCCEEDED(IWebBrowserApp_get_HWND(app, &handle)) && (HWND)handle == target) {
                IShellBrowser *browser = browserOf(dispatch);
                if (browser) {
                    HWND tab = NULL;
                    IShellBrowser_GetWindow(browser, &tab);
                    if (!activeTab || tab == activeTab) chosen = browser;
                    else if (!fallback) fallback = browser;
                    else IShellBrowser_Release(browser);
                }
            }
            IWebBrowserApp_Release(app);
        }
        IDispatch_Release(dispatch);
    }
    if (!chosen) { chosen = fallback; fallback = NULL; }
    if (chosen) { putSelection(chosen); IShellBrowser_Release(chosen); } else put("[]");
    if (fallback) IShellBrowser_Release(fallback);
    IShellWindows_Release(windows);
    put("}");
}

static void desktopSelection(void) {
    IShellWindows *windows = NULL;
    put("{\"paths\":");
    if (FAILED(CoCreateInstance(&CLSID_ShellWindows, NULL, CLSCTX_ALL, &IID_IShellWindows, (void **)&windows)) || !windows) {
        put("[]}");
        return;
    }
    VARIANT empty;
    VariantInit(&empty);
    long hwnd = 0;
    IDispatch *dispatch = NULL;
    if (SUCCEEDED(IShellWindows_FindWindowSW(windows, &empty, &empty, SWC_DESKTOP, &hwnd, SWFO_NEEDDISPATCH, &dispatch)) && dispatch) {
        IShellBrowser *browser = browserOf(dispatch);
        if (browser) { putSelection(browser); IShellBrowser_Release(browser); } else put("[]");
        IDispatch_Release(dispatch);
    } else put("[]");
    IShellWindows_Release(windows);
    put("}");
}

/* ------------------------------------------------------------------ main */

int wmain(void) {
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    SetConsoleOutputCP(CP_UTF8);
    char line[1024];
    while (fgets(line, sizeof line, stdin)) {
        char id[32] = "0";
        char cmd[32] = "";
        char arg[960] = "";
        line[strcspn(line, "\r\n")] = 0;
        if (sscanf(line, "%31s %31s %959[^\n]", id, cmd, arg) < 2) continue;
        outLen = 0;
        out[0] = 0;

        if (!strcmp(cmd, "fg")) {
            HWND hwnd = GetForegroundWindow();
            wchar_t cls[256] = L"", title[512] = L"";
            char num[32];
            if (hwnd) { GetClassNameW(hwnd, cls, 256); GetWindowTextW(hwnd, title, 512); }
            snprintf(num, sizeof num, "%lld", (long long)(INT_PTR)hwnd);
            put("{\"hwnd\":"); put(num); put(",\"cls\":"); putWide(cls); put(",\"title\":"); putWide(title); put("}");
        } else if (!strcmp(cmd, "focus")) {
            HWND hwnd = (HWND)(INT_PTR)_strtoi64(arg, NULL, 10);
            put(focusWindow(hwnd) ? "{\"ok\":true}" : "{\"ok\":false}");
        } else if (!strcmp(cmd, "waitmods")) {
            DWORD limit = (DWORD)atoi(arg);
            DWORD start = GetTickCount();
            while (modsDown() && GetTickCount() - start < limit) Sleep(10);
            put("{\"ok\":true}");
        } else if (!strcmp(cmd, "paste")) {
            chord('V');
            put("{\"ok\":true}");
        } else if (!strcmp(cmd, "copy")) {
            chord('C');
            put("{\"ok\":true}");
        } else if (!strcmp(cmd, "seq")) {
            char num[48];
            snprintf(num, sizeof num, "{\"seq\":%lu}", (unsigned long)GetClipboardSequenceNumber());
            put(num);
        } else if (!strcmp(cmd, "private")) {
            put(clipboardPrivate() ? "{\"private\":true}" : "{\"private\":false}");
        } else if (!strcmp(cmd, "explorer")) {
            explorerSelection((HWND)(INT_PTR)_strtoi64(arg, NULL, 10));
        } else if (!strcmp(cmd, "desktop")) {
            desktopSelection();
        } else if (!strcmp(cmd, "hasimage")) {
            UINT png = RegisterClipboardFormatW(L"PNG");
            int has = (png && IsClipboardFormatAvailable(png)) || IsClipboardFormatAvailable(CF_DIB) || IsClipboardFormatAvailable(CF_BITMAP);
            put(has ? "{\"image\":true}" : "{\"image\":false}");
        } else if (!strcmp(cmd, "clipimage")) {
            const char *kind = saveClipboardImage(arg);
            if (kind) { put("{\"ok\":true,\"format\":\""); put(kind); put("\"}"); } else put("{\"ok\":false}");
        } else if (!strcmp(cmd, "ping")) {
            put("{\"pong\":true}");
        } else {
            put("{\"error\":\"unknown command\"}");
        }
        reply(id);
    }
    CoUninitialize();
    return 0;
}
