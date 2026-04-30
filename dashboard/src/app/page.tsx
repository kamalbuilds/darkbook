import { Hero } from "@/components/landing/hero";
import { TickerBar } from "@/components/landing/ticker-bar";
import { WhyDarkBook } from "@/components/landing/why-darkbook";
import { ArchitectureDiagram } from "@/components/landing/architecture-diagram";
import { OrderBookTeaser } from "@/components/landing/order-book-teaser";
import { ComparisonTable } from "@/components/landing/comparison-table";
import { TechStack } from "@/components/landing/tech-stack";
import { Sponsors } from "@/components/landing/sponsors";
import { Footer } from "@/components/landing/footer";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 scroll-smooth">
      {/* 1. Hero with animated gradient mesh + CTAs */}
      <Hero />

      {/* 2. Live ticker bar (Pyth Lazer price, volume, OI, ER block) */}
      <TickerBar />

      {/* 3. Three-column value props */}
      <WhyDarkBook />

      {/* 4. Architecture diagram (animated SVG data flow) */}
      <ArchitectureDiagram />

      {/* 5. Order book teaser (animated, demo-labeled) */}
      <OrderBookTeaser />

      {/* 6. Comparison table vs competitors */}
      <ComparisonTable />

      {/* 7. Tech stack badges */}
      <TechStack />

      {/* 8. Sponsor tracks */}
      <Sponsors />

      {/* 9. Footer */}
      <Footer />
    </main>
  );
}
