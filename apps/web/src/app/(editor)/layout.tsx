import { AuthGate } from '@/components/layout/auth-gate';

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
