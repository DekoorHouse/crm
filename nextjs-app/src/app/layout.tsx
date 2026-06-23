import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import AuthProvider from "@/components/layout/AuthProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { Toaster } from "react-hot-toast";
import "./globals.css";

// Aplica el tema guardado ANTES de pintar (evita el parpadeo claro→oscuro).
// No puede importar módulos, así que conoce los ids/temas oscuros inline.
const THEME_INIT_SCRIPT = `(function(){try{
  var raw=localStorage.getItem("dekoor-theme");
  var valid=["dekoor","obsidian","lila","elegante","minimal"];
  var id=valid.indexOf(raw)>=0?raw:(raw==="dark"?"obsidian":"dekoor");
  var dark=["obsidian"];
  var el=document.documentElement;
  el.setAttribute("data-theme",id);
  el.classList.toggle("dark",dark.indexOf(id)>=0);
}catch(e){}})();`;

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-headline",
  weight: ["400", "500", "600", "700", "800"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Dekoor CRM - Gestión de Pedidos",
  description: "Sistema de gestión de pedidos para Dekoor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${plusJakarta.variable} ${manrope.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-background text-on-surface font-body antialiased">
        <ThemeProvider>
          <AuthProvider>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: "var(--color-surface-container-high)",
                  color: "var(--color-on-surface)",
                  borderRadius: "12px",
                },
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
