// Use electron-builder's pinned tool downloads and configured cache directory.
const { NsisTargetOptions, NSIS_PATH } = require('app-builder-lib/out/targets/nsis/nsisUtil');
const { getSignVendorPath } = require('app-builder-lib/out/codeSign/windowsSignToolManager');
NsisTargetOptions.resolve({});
Promise.all([NSIS_PATH(), getSignVendorPath()]).then(paths => {
  console.log('Windows packaging tools ready:', paths.join(', '));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
