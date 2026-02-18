import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User, Clock } from "lucide-react";
import { Link } from "wouter";
import paylinkLogo from "@assets/PayLink_Logo_transparent_1771416877301.png";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-muted/50">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="flex flex-col items-center gap-3">
          <img src={paylinkLogo} alt="PayLink" className="h-24 w-24 object-contain" />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-login-title">
              PayLink
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              HR & Payroll Management
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <User className="h-3.5 w-3.5" /> Username
                </Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  data-testid="input-username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  data-testid="input-password"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive text-center" data-testid="text-login-error">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading || !username || !password}
                data-testid="button-login"
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="flex justify-center">
          <Link href="/time-clock">
            <Button variant="ghost" className="text-muted-foreground" data-testid="link-timeclock">
              <Clock className="h-4 w-4 mr-2" />
              Employee Time Clock
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
