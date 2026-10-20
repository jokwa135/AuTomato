const path = require('node:path');
module.exports = {
  appId: 'com.automatobot.desktop', productName: 'AuTomato',
  directories: { app: path.resolve(__dirname, '../output/local-package'), output: path.resolve(__dirname, '../dist/automato') },
  electronVersion: '39.2.7', electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
  npmRebuild: false, files: ['desktop/**/*', 'package.json'],
  win: { target: 'dir', icon: path.resolve(__dirname, 'assets/automato.png'), signAndEditExecutable: false }
};
