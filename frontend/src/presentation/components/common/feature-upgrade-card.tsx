import { Crown, Lock } from "lucide-react";
import { FeatureKey, SaasPlan } from "../../../domain/constants/entitlements";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

type FeatureUpgradeCardProps = {
  feature: FeatureKey;
  currentPlan: SaasPlan;
  requiredPlan: SaasPlan | null;
  compact?: boolean;
};

export const FeatureUpgradeCard = ({ feature, currentPlan, requiredPlan, compact = false }: FeatureUpgradeCardProps) => {
  return (
    <Card className="border-amber-300/60 bg-amber-50/70 dark:border-amber-500/35 dark:bg-amber-500/10">
      <CardHeader className={compact ? "pb-2" : undefined}>
        <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-200">
          <Lock className="h-4 w-4" />
          Feature premium bloccata
        </CardTitle>
      </CardHeader>
      <CardContent className={compact ? "pt-0" : undefined}>
        <p className="text-sm text-amber-900/90 dark:text-amber-200/90">
          La funzionalità <span className="font-semibold">{feature}</span> non è inclusa nel tuo piano attuale.
        </p>
        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
          Piano attuale: <strong>{currentPlan}</strong>
          {requiredPlan ? (
            <>
              {" · "}Piano richiesto: <strong>{requiredPlan}</strong>
            </>
          ) : null}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" className="border-amber-500/40 bg-amber-100/50 text-amber-900 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100 dark:hover:bg-amber-500/30">
            <Crown className="h-3.5 w-3.5" />
            Upgrade piano
          </Button>
          <p className="text-[11px] text-amber-800/75 dark:text-amber-200/75">Contatta il supporto piattaforma per abilitare questa feature.</p>
        </div>
      </CardContent>
    </Card>
  );
};
