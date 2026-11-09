import { AuthGate } from '@/components/layout/auth-gate';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar, VerifyBanner } from '@/components/layout/topbar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <VerifyBanner />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 animate-fade-in">{children}</main>
        </div>
      </div>
    </AuthGate>
  );
}
