import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Swift Tours",
};

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </main>
  );
}
