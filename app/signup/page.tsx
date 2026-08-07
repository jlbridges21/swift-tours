import type { Metadata } from "next";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create your Swift Tours account",
};

export default function SignupPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <SignupForm />
      </div>
    </main>
  );
}
