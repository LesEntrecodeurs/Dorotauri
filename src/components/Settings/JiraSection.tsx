import { useState } from 'react';
import { Eye, EyeOff, Loader2, TicketCheck, CheckCircle, XCircle } from 'lucide-react';
import { Toggle } from './Toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { AppSettings } from './types';

interface JiraSectionProps {
  appSettings: AppSettings;
  onSaveAppSettings: (updates: Partial<AppSettings>) => void;
  onUpdateLocalSettings: (updates: Partial<AppSettings>) => void;
}

export const JiraSection = ({ appSettings, onSaveAppSettings, onUpdateLocalSettings }: JiraSectionProps) => {
  const [showApiToken, setShowApiToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    if (!window.electronAPI?.jira?.test) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Save credentials first so the main process has them
      onSaveAppSettings({
        jiraDomain: appSettings.jiraDomain,
        jiraEmail: appSettings.jiraEmail,
        jiraApiToken: appSettings.jiraApiToken,
      });
      // Small delay to let settings save
      await new Promise(r => setTimeout(r, 300));

      const result = await window.electronAPI.jira.test();
      if (result.success) {
        setTestResult({ success: true, message: `Connected as ${result.displayName} (${result.email})` });
      } else {
        setTestResult({ success: false, message: result.error || 'Connection failed' });
      }
    } catch (err) {
      setTestResult({ success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTesting(false);
    }
  };

  const canEnable = !!(appSettings.jiraDomain && appSettings.jiraEmail && appSettings.jiraApiToken);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">JIRA Integration</h2>
        <p className="text-sm text-muted-foreground">Connect to JIRA to poll issues and update status</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-3">
              <TicketCheck className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Enable JIRA Integration</p>
                <p className="text-sm text-muted-foreground">
                  {canEnable
                    ? 'Poll JIRA issues and let agents update them'
                    : 'Fill in credentials below to enable'}
                </p>
              </div>
            </div>
            <Toggle
              enabled={appSettings.jiraEnabled}
              onChange={() => onSaveAppSettings({ jiraEnabled: !appSettings.jiraEnabled })}
              disabled={!canEnable}
            />
          </div>

          <Separator />

          <div className="space-y-6 pt-6">
            {/* Domain */}
            <div>
              <Label className="block mb-2">JIRA Domain</Label>
              <Input
                type="text"
                value={appSettings.jiraDomain}
                onChange={(e) => onUpdateLocalSettings({ jiraDomain: e.target.value })}
                onBlur={() => {
                  if (appSettings.jiraDomain) {
                    onSaveAppSettings({ jiraDomain: appSettings.jiraDomain });
                  }
                }}
                placeholder="mycompany.atlassian.net or issues.example.com"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Full hostname -- e.g. mycompany.atlassian.net or your self-hosted domain
              </p>
            </div>

            {/* Email */}
            <div>
              <Label className="block mb-2">Email</Label>
              <Input
                type="email"
                value={appSettings.jiraEmail}
                onChange={(e) => onUpdateLocalSettings({ jiraEmail: e.target.value })}
                onBlur={() => {
                  if (appSettings.jiraEmail) {
                    onSaveAppSettings({ jiraEmail: appSettings.jiraEmail });
                  }
                }}
                placeholder="you@company.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The email address associated with your Atlassian account
              </p>
            </div>

            {/* API Token */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>API Token</Label>
                <a
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Create API token
                </a>
              </div>
              <div className="relative">
                <Input
                  type={showApiToken ? 'text' : 'password'}
                  value={appSettings.jiraApiToken}
                  onChange={(e) => onUpdateLocalSettings({ jiraApiToken: e.target.value })}
                  onBlur={() => {
                    if (appSettings.jiraApiToken) {
                      onSaveAppSettings({ jiraApiToken: appSettings.jiraApiToken });
                    }
                  }}
                  placeholder="ATATT3xFfGF0..."
                  className="pr-10 font-mono"
                />
                <button
                  onClick={() => setShowApiToken(!showApiToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                >
                  {showApiToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Test Connection */}
            <div>
              <Button
                variant="secondary"
                onClick={handleTestConnection}
                disabled={!canEnable || testing}
              >
                {testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TicketCheck className="w-4 h-4" />
                )}
                Test Connection
              </Button>
            </div>

            {testResult && (
              <div className={`p-3 text-sm flex items-center gap-2 ${
                testResult.success
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-destructive border border-red-500/20'
              }`}>
                {testResult.success ? <CheckCircle className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                {testResult.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Setup Guide */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-medium mb-4">Setup Guide</h3>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>Go to your Atlassian account security settings</li>
            <li>Create an API token at <code className="bg-secondary px-1">id.atlassian.com/manage-profile/security/api-tokens</code></li>
            <li>Enter your JIRA hostname (e.g. mycompany.atlassian.net or your self-hosted domain)</li>
            <li>Enter the email associated with your Atlassian account</li>
            <li>Paste your API token and click &quot;Test Connection&quot;</li>
            <li>Create an automation with JIRA as the source</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};
