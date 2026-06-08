import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Building2, Loader2, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const signupSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  termsAccepted: z.boolean().refine((v) => v === true, {
    message: "You must accept the Terms of Service and Privacy Policy",
  }),
});

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      companyName: "",
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      termsAccepted: false,
    },
  });

  const onSubmit = async (values: SignupForm) => {
    setIsSubmitting(true);
    try {
      // apiRequest throws on non-2xx, so we catch errors in the outer catch block
      const signupRes = await apiRequest("POST", "/api/trial/signup", {
        companyName: values.companyName,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        termsAccepted: values.termsAccepted,
      });
      const signupData = await signupRes.json();

      // Auto-login with the returned credentials
      try {
        await apiRequest("POST", "/api/auth/login", {
          username: signupData.username,
          password: signupData.temporaryPassword,
        });
        setLocation("/app/onboarding");
      } catch {
        // Login step failed — account was created; direct user to login
        toast({
          title: "Account created!",
          description: "Please log in with your new credentials.",
        });
        setLocation("/login");
      }
    } catch (e: any) {
      toast({
        title: "Signup failed",
        description: e?.message || "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-700 via-teal-800 to-blue-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight mb-2">
          <Building2 className="h-6 w-6 text-teal-600" />
          <span className="text-teal-700">Pay</span><span className="dark:text-white">Link</span>
        </div>
        <h1 className="text-2xl font-bold mb-1 dark:text-white">Start your free trial</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          30 days free — no credit card required.
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Acme Corp"
                      data-testid="input-company-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Jane"
                        data-testid="input-first-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Doe"
                        data-testid="input-last-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="jane@acme.com"
                      data-testid="input-email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      data-testid="input-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="termsAccepted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-terms"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="font-normal text-sm text-gray-600 dark:text-gray-400">
                      I agree to the{" "}
                      <a href="/terms" className="underline text-teal-700 hover:text-teal-800" target="_blank" rel="noopener noreferrer">
                        Terms of Service
                      </a>{" "}
                      and{" "}
                      <a href="/privacy" className="underline text-teal-700 hover:text-teal-800" target="_blank" rel="noopener noreferrer">
                        Privacy Policy
                      </a>
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold"
              disabled={isSubmitting}
              data-testid="button-signup-submit"
            >
              {isSubmitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…</>
              ) : (
                <>Create free account <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{" "}
          <button
            className="text-teal-700 hover:underline font-medium"
            onClick={() => setLocation("/login")}
            data-testid="link-go-to-login"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
