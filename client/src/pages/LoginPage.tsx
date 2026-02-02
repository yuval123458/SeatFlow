import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

interface LoginPageProps {
  onLogin?: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [step, setStep] = useState<"login" | "selectOrg">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const organizations = [
    { id: "1", name: "Acme Corporation" },
    { id: "2", name: "Global Events Ltd" },
    { id: "3", name: "Stadium Management Co" },
    { id: "4", name: "Concert Venues Inc" },
  ];

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("selectOrg");
  };

  const handleOrgSelect = () => {
    onLogin?.();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0B1220] via-[#1E293B] to-[#1E3A8A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[#1E3A8A] to-[#06B6D4] rounded-2xl mb-4 shadow-lg">
            <span className="text-white font-bold text-2xl">SF</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">SeatFlow</h1>
          <p className="text-[#94A3B8]">Seat assignment for large venues</p>
        </div>

        {step === "login" ? (
          /* Login Form */
          <Card className="p-8 bg-white/95 backdrop-blur shadow-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-[#0B1220] mb-2">
                Welcome back
              </h2>
              <p className="text-sm text-[#64748B]">
                Sign in to your account to continue
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john.doe@acme.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5"
                  required
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5"
                  required
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) =>
                      setRememberMe(checked as boolean)
                    }
                  />
                  <Label
                    htmlFor="remember"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Remember me
                  </Label>
                </div>
                <button
                  type="button"
                  className="text-sm text-[#1E3A8A] hover:text-[#06B6D4] font-medium transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                className="w-full bg-[#1E3A8A] hover:bg-[#2563EB]"
              >
                Continue
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
              <p className="text-center text-sm text-[#64748B]">
                Don't have an account?{" "}
                <button className="text-[#1E3A8A] hover:text-[#06B6D4] font-medium transition-colors">
                  Contact your administrator
                </button>
              </p>
            </div>
          </Card>
        ) : (
          /* Organization Selection */
          <Card className="p-8 bg-white/95 backdrop-blur shadow-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-[#0B1220] mb-2">
                Select organization
              </h2>
              <p className="text-sm text-[#64748B]">
                Choose which organization to sign in to
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <Label htmlFor="organization">Organization</Label>
                <Select onValueChange={handleOrgSelect}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Select your organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4">
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  className="text-sm text-[#64748B] hover:text-[#1E3A8A] transition-colors"
                >
                  ← Back to login
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm text-[#94A3B8]">
            © 2026 SeatFlow. All rights reserved.
          </p>
        </div>
      </div>

      {/* Responsive Display Info */}
      <div className="fixed bottom-4 left-4 bg-[#0B1220]/80 backdrop-blur text-white px-3 py-2 rounded-lg text-xs font-mono">
        <span className="hidden lg:inline">Desktop 1440px+</span>
        <span className="lg:hidden">Mobile 390px</span>
      </div>
    </div>
  );
}
