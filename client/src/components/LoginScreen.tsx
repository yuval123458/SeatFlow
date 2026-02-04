import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

import { getOrganizations, login, type Organization } from "../lib/api";

export interface LoginScreenProps {
  onLogin?: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<"login" | "selectOrg">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ id: String(o.id), name: o.name })),
    [orgs],
  );

  const loadOrgs = async () => {
    setError(null);
    setOrgsLoading(true);
    try {
      const data = await getOrganizations();
      setOrgs(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load organizations");
    } finally {
      setOrgsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setStep("selectOrg");
    if (orgs.length === 0) {
      await loadOrgs();
    }
  };

  const handleOrgSelect = async (orgIdStr: string) => {
    setError(null);
    const org_id = Number(orgIdStr);
    if (!org_id) {
      setError("Invalid organization.");
      return;
    }

    setLoginLoading(true);
    try {
      const token = await login(org_id, email.trim().toLowerCase(), password);

      const storage = rememberMe ? window.localStorage : window.sessionStorage;
      storage.setItem("access_token", token.access_token);
      storage.setItem("token_type", token.token_type);
      storage.setItem("org_id", String(org_id));

      onLogin?.();

      const from = (location.state as any)?.from?.pathname || "/dashboard";
      navigate(from, { replace: true });
    } catch (e: any) {
      setError(e?.message || "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    if (step === "selectOrg" && orgs.length === 0 && !orgsLoading) {
      void loadOrgs();
    }
  }, [step, orgs.length, orgsLoading]);

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
          <Card className="p-8 bg-white/95 backdrop-blur shadow-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-[#0B1220] mb-2">
                Welcome back
              </h2>
              <p className="text-sm text-[#64748B]">
                Sign in to your account to continue
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

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
          <Card className="p-8 bg-white/95 backdrop-blur shadow-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-[#0B1220] mb-2">
                Select organization
              </h2>
              <p className="text-sm text-[#64748B]">
                Choose which organization to sign in to
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <Label htmlFor="organization">Organization</Label>
                <Select
                  onValueChange={handleOrgSelect}
                  disabled={orgsLoading || loginLoading}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue
                      placeholder={
                        orgsLoading
                          ? "Loading organizations..."
                          : "Select your organization"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {orgOptions.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                    {!orgsLoading && orgOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-[#64748B]">
                        No organizations found.
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("login")}
                  className="text-sm text-[#64748B] hover:text-[#1E3A8A] transition-colors"
                  disabled={loginLoading}
                >
                  ← Back to login
                </button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={loadOrgs}
                  disabled={orgsLoading || loginLoading}
                >
                  Refresh list
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="mt-8 text-center">
          <p className="text-sm text-[#94A3B8]">
            © 2026 SeatFlow. All rights reserved.
          </p>
        </div>
      </div>

      <div className="fixed bottom-4 left-4 bg-[#0B1220]/80 backdrop-blur text-white px-3 py-2 rounded-lg text-xs font-mono">
        <span className="hidden lg:inline">Desktop 1440px+</span>
        <span className="lg:hidden">Mobile 390px</span>
      </div>
    </div>
  );
}
