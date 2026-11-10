'use client';

import dynamic from 'next/dynamic';

// The whole app reads localStorage, geolocation and the WebGL map on
// first render, so it runs in the browser only.
const App = dynamic(() => import('@/components/App'), { ssr: false });

export default function Page() {
  return <App />;
}
