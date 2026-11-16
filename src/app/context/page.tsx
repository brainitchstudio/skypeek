import type { Metadata } from 'next';
import { ContextGallery } from './ContextGallery';
import './context.css';

export const metadata: Metadata = {
  title: 'Weather context concepts | Sky Peek',
  description: 'Design explorations for optional, evidence-backed weather context in Sky Peek.',
};

export default function ContextPage() {
  return <ContextGallery />;
}
