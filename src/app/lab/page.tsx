'use client';
import dynamic from 'next/dynamic';
const Lab = dynamic(() => import('@/components/Lab'), { ssr: false });
export default function LabPage() { return <Lab />; }
