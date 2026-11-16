'use client';

import dynamic from 'next/dynamic';

// Weather state, geolocation, and WebGL maps initialize in the browser.
const App = dynamic(() => import('@/components/App'), { ssr: false });

export default function Page() {
  return <App />;
}
