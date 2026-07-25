/**
 * brandPricing — pure helpers for the brand store-price "apply scope" decision.
 *
 * Keeps the risky decision logic (when to propagate a store-price change to a brand's ACTIVE
 * contracts vs. only the new-contract default) out of the React component so it can be unit-tested.
 *
 * This module performs NO I/O and touches NO PayApp/subscription logic. It only decides what the
 * save flow should do, given the mode, the original vs. new price, and the operator's chosen scope.
 */

export type BrandPriceApplyScope = 'registry_only' | 'active_contracts';

export interface BrandPricingPlan {
  /** true when the operator actually changed the store price (edit mode only). */
  priceChanged: boolean;
  /** whether to call admin_update_brand_registry_pricing (only when the price changed). */
  callPricingRpc: boolean;
  /** whether to also push the new price onto ACTIVE contracts. */
  applyToActiveContracts: boolean;
  /** whether a confirmation modal must be shown before saving (the risky option). */
  showConfirmModal: boolean;
}

export interface PlanBrandPricingSaveArgs {
  mode: 'create' | 'edit';
  /** existing registry default_store_price; null when unknown/creating. */
  originalPrice: number | null;
  /** the price currently entered in the form. */
  newPrice: number;
  /** operator's chosen apply scope (only meaningful in edit mode). */
  scope: BrandPriceApplyScope;
}

/**
 * Decide what the save flow should do.
 *
 * - create: never propagates; the create RPC just seeds the new-contract default. (Scenario A)
 * - edit + price unchanged: no pricing RPC at all, regardless of scope. (Scenario D — no-op)
 * - edit + price changed + registry_only: pricing RPC, no contract propagation. (Scenario B)
 * - edit + price changed + active_contracts: pricing RPC + propagation + confirm modal. (Scenario C)
 */
export function planBrandPricingSave(args: PlanBrandPricingSaveArgs): BrandPricingPlan {
  const { mode, originalPrice, newPrice, scope } = args;

  if (mode === 'create') {
    return {
      priceChanged: false,
      callPricingRpc: false,
      applyToActiveContracts: false,
      showConfirmModal: false,
    };
  }

  const priceChanged = originalPrice === null ? true : newPrice !== originalPrice;
  const applyToActiveContracts = priceChanged && scope === 'active_contracts';

  return {
    priceChanged,
    callPricingRpc: priceChanged,
    applyToActiveContracts,
    showConfirmModal: applyToActiveContracts,
  };
}
