import { Button } from "@/components/ui/button";

export function OAuthButtons() {
  const google = !!process.env.GOOGLE_CLIENT_ID, apple = !!process.env.APPLE_CLIENT_ID;
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="w-full" disabled={!google}>Continue with Google</Button>
      <Button type="button" variant="outline" className="w-full" disabled={!apple}>Continue with Apple</Button>
      {(!google || !apple) && <p className="text-xs text-navy-900/55">Google and Apple sign-in are provided through Supabase Auth / OAuth in production and aren&apos;t configured in this environment — email sign-in works fully.</p>}
    </div>
  );
}
