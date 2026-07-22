# 09 — Test Schema Certification
Verified on Test `hao…qorr` (read-only metadata):
- **Tables:** support_inquiries, support_inquiry_attachments exist, **RLS enabled** (both).
- **Functions (7):** exist; identity args **match Production**; grants `authenticated` only (no anon).
- **Repository ⇄ Test:** match for Cluster B. **⇄ Production:** signatures/return/security match (verbatim). No intended drift (Cluster B needed no security fix).
- Cluster A objects intact (no regression).
