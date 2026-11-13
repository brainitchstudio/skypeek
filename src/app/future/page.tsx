import type { Metadata } from 'next';
import { FutureApp } from './FutureApp';
import './future.css';

export const metadata: Metadata = {
  title: 'Sky Peek · iOS Prototype',
  description: 'A mobile prototype of Sky Peek with live forecasts, radar, and alerts.',
};

export default function FuturePage() {
  return <FutureApp/>;
}
