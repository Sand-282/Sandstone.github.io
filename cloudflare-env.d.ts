declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ADMIN_EMAIL?: string;
    AUTH_MODE?: string;
    ADMIN_PASSWORD?: string;
    PAGES_ORIGIN?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    SITE_URL?: string;
  }
}
