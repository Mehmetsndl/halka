// electron-builder afterPack hook: stamps Halka's icon and version info into
// Halka.exe with resedit (pure JS), so Windows builds made on Linux/macOS
// don't need Wine/rcedit.
import fs from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'assets', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, icon.icons.map((item) => item.data));

  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const info = infos[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const lang = info.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
  info.setFileVersion(major, minor, patch, 0, lang.lang);
  info.setProductVersion(major, minor, patch, 0, lang.lang);
  info.setStringValues(lang, {
    ProductName: 'Halka',
    FileDescription: 'Halka',
    CompanyName: 'Halka',
    InternalName: 'Halka',
    OriginalFilename: `${productFilename}.exe`,
    LegalCopyright: 'Copyright © 2026 Mehmet Şendil',
    FileVersion: version,
    ProductVersion: version
  });
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • stamped icon and version ${version} into ${path.basename(exePath)}`);
}
