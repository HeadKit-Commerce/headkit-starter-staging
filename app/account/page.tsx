"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/headkit-ui/auth-context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login, registerUser } from "@/lib/account-actions";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z
  .object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().min(1, "Email is required").email("Invalid email"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[a-z]/, "Must contain at least one lowercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const caaEnabled = process.env.NEXT_PUBLIC_SHOPIFY_CAA_ENABLED === "true";

export default function Page() {
  const [error, setError] = useState<string | null>(null);
  const [caaError, setCaaError] = useState<string | null>(null);
  const { setAuthToken } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const msg = new URLSearchParams(window.location.search).get("caa_error");
    if (msg) setCaaError(msg);
  }, []);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const handleLogin = async (data: z.infer<typeof loginSchema>) => {
    setError(null);
    const result = await login(data.email, data.password);
    if (result.success && result.data) {
      setAuthToken(result.data.token, {
        id: result.data.userId,
        email: result.data.email,
        firstName: result.data.firstName,
        lastName: result.data.lastName,
        refreshToken: result.data.refreshToken,
      });
      setTimeout(() => router.push("/account/profile"), 100);
    } else {
      setError(result.error ?? "Invalid email or password");
    }
  };

  const handleRegister = async (data: z.infer<typeof registerSchema>) => {
    setError(null);
    const result = await registerUser({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
    });
    if (result.success && result.data) {
      setAuthToken(result.data.token, {
        id: result.data.userId,
        email: result.data.email,
        firstName: result.data.firstName,
        lastName: result.data.lastName,
        refreshToken: result.data.refreshToken,
      });
      setTimeout(() => router.push("/account/profile"), 100);
    } else {
      setError(result.error ?? "Failed to create account. Please try again.");
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl mx-auto">
        {/* Sign In */}
        <div className="bg-white rounded-lg p-6">
          <h2 className="text-3xl text-primary mb-6">Sign In</h2>
          {(error || caaError) && (
            <div className="mb-4 p-4 text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error ?? `Shopify sign-in failed (${caaError})`}
            </div>
          )}
          {caaEnabled ? (
            <div className="mb-6 space-y-3">
              <Button asChild className="w-full" variant="default">
                <a href="/api/auth/shopify-caa">Continue with Shopify</a>
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Or sign in with email and password
              </p>
            </div>
          ) : null}
          <Form {...loginForm}>
            <form
              onSubmit={loginForm.handleSubmit(handleLogin)}
              className="space-y-4"
            >
              <FormField
                name="email"
                control={loginForm.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="Enter your email"
                        autoComplete="username"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="password"
                control={loginForm.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter your password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <Link
                  href="/account/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  Forgot Password?
                </Link>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loginForm.formState.isSubmitting}
              >
                {loginForm.formState.isSubmitting ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </Form>
        </div>

        {/* Create Account */}
        <div className="bg-white rounded-lg p-6">
          <h2 className="text-3xl text-primary mb-6">Create Account</h2>
          <Form {...registerForm}>
            <form
              onSubmit={registerForm.handleSubmit(handleRegister)}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  name="firstName"
                  control={registerForm.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="First name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  name="lastName"
                  control={registerForm.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input type="text" placeholder="Last name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                name="email"
                control={registerForm.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="Enter your email"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="password"
                control={registerForm.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Create a password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="confirmPassword"
                control={registerForm.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Confirm your password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={registerForm.formState.isSubmitting}
              >
                {registerForm.formState.isSubmitting
                  ? "Creating account…"
                  : "Create Account"}
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  );
}
