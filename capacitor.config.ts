import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.61efc4aebed64fa992997ce90d249e3f',
  appName: 'modertik5',
  webDir: 'dist',
  server: {
    url: 'https://61efc4ae-bed6-4fa9-9299-7ce90d249e3f.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    AdMob: {
      appIdAndroid: 'ca-app-pub-5311550066318725~2062254497',
      appIdIos: 'ca-app-pub-5311550066318725~2062254497',
    }
  }
};

export default config;
