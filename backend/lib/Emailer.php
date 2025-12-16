<?php

namespace Midway\Backend;

use RuntimeException;

class Emailer
{
    private static ?self $instance = null;

    private bool $sendEmails;
    private string $appEnv;
    private string $apiKey;
    private string $staffEmail;
    private string $alertsEmail;
    private string $notificationsFrom;
    private string $alertsFrom;

    private function __construct()
    {
        $this->apiKey = (string) Env::get('SENDGRID_API_KEY', '');
        $this->appEnv = strtolower((string) Env::get('APP_ENV', 'development'));
        $sendToggle = Env::get('SEND_EMAILS', null);
        $sendEnabled = $sendToggle !== null ? filter_var($sendToggle, FILTER_VALIDATE_BOOL) : false;
        $this->sendEmails = ($this->appEnv === 'production') && $sendEnabled;

        $this->staffEmail = (string) Env::get('STAFF_EMAIL_TO', 'midwayeventcenter@gmail.com');
        $this->alertsEmail = (string) Env::get('ALERTS_EMAIL_TO', 'support@jamarq.digital');
        $this->notificationsFrom = (string) Env::get('EMAIL_FROM_NOTIFICATIONS', 'notifications@midwaymusichall.net');
        $this->alertsFrom = (string) Env::get('EMAIL_FROM_ALERTS', 'alerts@midwaymusichall.net');

        if ($this->sendEmails && $this->apiKey === '') {
            $this->sendEmails = false;
            error_log('[email] SENDGRID_API_KEY missing - disabling outbound email');
        }
    }

    public static function instance(): self
    {
        if (!self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function notificationsSender(): string
    {
        return $this->notificationsFrom;
    }

    public function alertsSender(): string
    {
        return $this->alertsFrom;
    }

    public function staffRecipient(): string
    {
        return $this->staffEmail;
    }

    public function alertsRecipient(): string
    {
        return $this->alertsEmail;
    }

    public function sendingEnabled(): bool
    {
        return $this->sendEmails;
    }

    /**
     * @param array{to:string|array, subject:string, body:string, from?:string, reply_to?:string, content_type?:string} $options
     */
    public function send(array $options): bool
    {
        $recipients = $this->normalizeRecipients($options['to'] ?? null);
        if (!$recipients) {
            error_log('[email] No recipients provided, skipping send');
            return false;
        }
        $subject = $this->sanitizeSubject($options['subject'] ?? '(no subject)');
        $body = (string) ($options['body'] ?? '');
        $from = $options['from'] ?? $this->notificationsFrom;
        $replyTo = $options['reply_to'] ?? null;
        $contentType = $options['content_type'] ?? 'text/plain';

        if (!$this->sendEmails || $this->appEnv !== 'production') {
            $this->logPreview('skip', $recipients, $subject, $body);
            return true;
        }
        if ($this->apiKey === '') {
            error_log('[email] Cannot send email - SENDGRID_API_KEY not configured');
            return false;
        }

        $personalizations = [
            [
                'to' => array_map(function ($email) {
                    return ['email' => $email];
                }, $recipients),
            ],
        ];

        $payload = [
            'personalizations' => $personalizations,
            'from' => ['email' => $from],
            'subject' => $subject,
            'content' => [
                [
                    'type' => $contentType,
                    'value' => $body,
                ],
            ],
        ];

        if ($replyTo) {
            $payload['reply_to'] = ['email' => $replyTo];
        }

        $encoded = json_encode($payload);
        if ($encoded === false) {
            throw new RuntimeException('Failed to encode email payload');
        }

        $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $this->apiKey,
            'Content-Type: application/json',
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $encoded);
        $response = curl_exec($ch);
        $error = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE) ?: 0;
        curl_close($ch);

        if ($response === false || $status >= 400) {
            $detail = $response === false ? $error : $response;
            error_log(sprintf('[email:error] status=%s subject="%s" detail=%s', $status ?: 'n/a', $subject, $this->truncate($detail, 300)));
            return false;
        }

        return true;
    }

    /**
     * @param mixed $rawRecipients
     * @return array<int,string>
     */
    private function normalizeRecipients($rawRecipients): array
    {
        $recipients = [];
        if (is_string($rawRecipients)) {
            $recipients = [$rawRecipients];
        } elseif (is_array($rawRecipients)) {
            $recipients = $rawRecipients;
        }

        $clean = [];
        foreach ($recipients as $email) {
            if (!is_string($email)) {
                continue;
            }
            $trimmed = trim($email);
            if ($trimmed === '') {
                continue;
            }
            $clean[] = $trimmed;
        }
        return array_values(array_unique($clean));
    }

    private function sanitizeSubject(string $subject): string
    {
        $subject = trim(preg_replace('/[\r\n]+/', ' ', $subject) ?? '');
        return $subject !== '' ? $subject : '(no subject)';
    }

    private function logPreview(string $status, array $recipients, string $subject, string $body): void
    {
        $preview = $this->truncate(preg_replace('/\s+/', ' ', strip_tags($body)) ?? '', 200);
        error_log(sprintf('[email:%s] to=%s subject="%s" preview="%s"', $status, implode(',', $recipients), $subject, $preview));
    }

    private function truncate(string $value, int $limit): string
    {
        if (strlen($value) <= $limit) {
            return $value;
        }
        return substr($value, 0, $limit) . '...';
    }
}
