<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Application Specification

## 🛠️ Development Environment

- **Language**: TypeScript (`^5.0.0`)
- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS
- **Linting**: ESLint with `@typescript-eslint`
- **Formatting**: Prettier
- **Package Manager**: `pnpm`, run inside the container via the rig (never on the host)

## 📂 Recommended Project Structure

```warp-runnable-command
.
├── app/                     # App Router structure
│   ├── layout.tsx
│   ├── page.tsx
│   ├── api/
├── components/              # UI components (custom)
├── hooks/                   # Custom React hooks
├── lib/                     # Client helpers, API wrappers, etc.
├── styles/                  # Tailwind customizations
├── tests/                   # Unit and integration tests
├── public/
├── README.md
├── .eslintrc.js
├── next.config.js
├── package.json
├── postcss.config.js
├── proxy.ts
└── tsconfig.json
```

## ⚙️ Dev Commands

Run from the repo root; the dev server starts with the container.

- **Start stack**: `rig up`
- **Install**: `rig www install`
- **Build**: `rig www build`
- **Lint**: `rig www lint`
- **Format**: `rig www format`
- **Other pnpm commands**: `rig exec www pnpm <command>`

## 🧱 Component Guidelines

- Co-locate component-specific styling in the same directory

## 📝 Code Style Standards

- Prefer arrow functions
- Annotate return types
- Always destructure props
- Avoid `any` type, use `unknown` or strict generics
- Group imports: react → next → libraries → local

## 🔐 Security

- Validate all server-side inputs (API routes)
- Use HTTPS-only cookies and CSRF tokens when applicable
- Protect sensitive routes with middleware or session logic

## External integrations
