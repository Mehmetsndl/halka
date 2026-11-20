# Third-party notices

Halka's own source code is released under the MIT License (see `LICENSE`).
It bundles or depends on the following components, each under its own license.

| Component | Version | License | Use in Halka |
| --- | --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 45.x | MIT (Chromium and its dependencies: see `LICENSES.chromium.html` next to `Halka.exe`) | Application runtime |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | Images → PDF |
| @pdf-lib/standard-fonts, @pdf-lib/upng | 1.0.x | MIT | pdf-lib dependencies |
| [pako](https://github.com/nodeca/pako) | 1.0.11 | MIT AND Zlib | pdf-lib dependency |
| [tslib](https://github.com/microsoft/tslib) | 1.14.1 | 0BSD | pdf-lib dependency |
| [tesseract.js](https://github.com/naptha/tesseract.js), tesseract.js-core | 7.x | Apache-2.0 | Offline OCR |
| [tessdata](https://github.com/tesseract-ocr/tessdata_best) (eng, tur; via @tesseract.js-data) | 4.0.0 best_int | Apache-2.0 | OCR language models (`resources/tessdata`) |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 | QR code reading |
| [Inter](https://github.com/rsms/inter) | 4.x | SIL Open Font License 1.1 (`assets/fonts/LICENSE-Inter.txt`) | Interface typeface |

`halka-helper.exe` is built from `native/halka-helper.c` in this repository (MIT) and links only
against the Windows system libraries and the MinGW-w64 runtime (whose static parts are
under permissive licenses / public domain).

Halka's ideas come from two MIT-licensed projects by Orkun Işıtmak:
[Nashi](https://github.com/orkunisitmak/nashi-app) (the conversion wheel) and
[ClipBoardLine](https://github.com/orkunisitmak/clipboardline) (the clipboard shelves).
No code, artwork or assets from Apple, Tangerine or any other third party are included;
the "macOS look" is recreated with original CSS and icons.

Translation uses the Google Translate web endpoint or the DeepL API (with the user's own key) at the user's request; no code from either service is bundled.
