import { Logo } from '@/components/icons';
import { CheckCircle2 } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10" />
          {children}
        </div>
      </div>
      <div className="brand-gradient relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:p-16">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="relative max-w-md text-white">
          <h2 className="text-3xl font-semibold leading-tight">Automate your business with workflows and AI agents that just work.</h2>
          <ul className="mt-8 space-y-3 text-white/90">
            {['Visual builder with 80+ nodes', 'AI agents with tools, memory and knowledge', 'Webhooks, schedules, forms and chat triggers', 'Real-time execution monitoring and debugging'].map((t) => (
              <li key={t} className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-white" />{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
