// electron-builder afterPack hook: flips Electron security fuses on the packaged app.
// Fuses are never relaxed here; smoke and e2e tests run against this exact configuration.
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const productName = packager.appInfo.productFilename;

  let target;
  if (electronPlatformName === 'darwin') {
    target = path.join(appOutDir, `${productName}.app`);
  } else if (electronPlatformName === 'win32') {
    target = path.join(appOutDir, `${productName}.exe`);
  } else {
    target = path.join(appOutDir, packager.executableName);
  }

  await flipFuses(target, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  });
};
