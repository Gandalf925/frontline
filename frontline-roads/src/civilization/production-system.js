import { deepClone, stableId } from '../core/utilities.js';
import { CIVILIZATION_PROJECTS, PRODUCTION_RECIPES } from './data.js';
import { addBundle, consumeBundle, hasBundle, missingBundle } from './inventory-system.js';

function queueFor(state, buildingId, create = false) {
  let queue = state.civilization.productionQueues.find(item => item.buildingId === buildingId);
  if (!queue && create) {
    queue = { buildingId, orders: [], current: null, completedUnits: 0, waitingForResources: false };
    state.civilization.productionQueues.push(queue);
  }
  return queue;
}

export function queuedProductionUnits(state, recipeId) {
  return (state.civilization?.productionQueues ?? []).reduce((total, queue) => total + (queue.orders ?? [])
    .filter(order => order.recipeId === recipeId)
    .reduce((sum, order) => sum + Math.max(0, Math.floor(Number(order.remaining) || 0)), 0), 0);
}

function queuedInputCommitment(state) {
  const committed = {};
  for (const queue of state.civilization?.productionQueues ?? []) {
    for (const order of queue.orders ?? []) {
      const recipe = PRODUCTION_RECIPES[order.recipeId];
      if (!recipe) continue;
      const currentUnit = queue.current?.orderId === order.id ? 1 : 0;
      const unstarted = Math.max(0, Math.floor(Number(order.remaining) || 0) - currentUnit);
      for (const [resource, amount] of Object.entries(recipe.input ?? {})) {
        committed[resource] = (committed[resource] ?? 0) + amount * unstarted;
      }
    }
  }
  return committed;
}

function projectRemainingUnits(state, recipeId, recipe, { includeQueued = true } = {}) {
  if (!recipe?.projectOnly) return 99;
  const project = state.civilization?.project;
  if (!project || ['BUILDING', 'PAUSED'].includes(project.status)) return 0;
  const definition = CIVILIZATION_PROJECTS[project.targetLevel];
  if (!definition) return 0;
  const queued = includeQueued ? queuedProductionUnits(state, recipeId) : 0;
  const limits = Object.entries(recipe.output ?? {}).map(([resource, output]) => {
    const required = definition.contributions?.[resource] ?? 0;
    const current = project.contributions?.[resource] ?? 0;
    return Math.floor(Math.max(0, required - current - queued * output) / Math.max(1, output));
  });
  return limits.length ? Math.max(0, Math.min(...limits)) : 0;
}

function projectCanAccept(state, recipeId, recipe) {
  return !recipe?.projectOnly || projectRemainingUnits(state, recipeId, recipe) > 0;
}

function baseCompatible(state, building, recipe) {
  return Boolean(
    building && building.hp > 0 && recipe &&
    recipe.building === building.type && (state.civilization.level ?? 0) >= recipe.level
  );
}

function compatible(state, building, recipeId, recipe) {
  return baseCompatible(state, building, recipe) && projectCanAccept(state, recipeId, recipe);
}

function queuedOrderCompatible(state, building, recipe) {
  if (!baseCompatible(state, building, recipe)) return false;
  if (!recipe?.projectOnly) return true;
  const project = state.civilization?.project;
  if (!project || ['BUILDING', 'PAUSED'].includes(project.status)) return false;
  const definition = CIVILIZATION_PROJECTS[project.targetLevel];
  if (!definition) return false;
  return Object.entries(recipe.output ?? {}).some(([resource]) =>
    (project.contributions?.[resource] ?? 0) < (definition.contributions?.[resource] ?? 0)
  );
}

export class ProductionSystem {
  constructor(events = null) {
    this.events = events;
  }

  availableRecipes(state, building) {
    return Object.entries(PRODUCTION_RECIPES)
      .filter(([id, recipe]) => compatible(state, building, id, recipe))
      .map(([id, recipe]) => ({ id, ...recipe }));
  }

  queueSummary(state, buildingId) {
    const queue = queueFor(state, buildingId, false);
    const pendingUnits = (queue?.orders ?? []).reduce((sum, order) => sum + Math.max(0, Math.floor(Number(order.remaining) || 0)), 0);
    return {
      pendingUnits,
      orderCount: queue?.orders?.length ?? 0,
      currentRecipeId: queue?.current?.recipeId ?? null,
      waitingForResources: Boolean(queue?.waitingForResources)
    };
  }

  maximumProducible(state, buildingId, recipeId, cap = 99) {
    const building = state.civilization.buildings.find(item => item.id === buildingId);
    const recipe = PRODUCTION_RECIPES[recipeId];
    if (!compatible(state, building, recipeId, recipe)) return { ok: false, quantity: 0, reason: 'この施設では現在生産できません。' };
    const committed = queuedInputCommitment(state);
    const limits = Object.entries(recipe.input ?? {}).map(([resource, amount]) => {
      const available = Math.max(0, (state.inventory.resources[resource] ?? 0) - (committed[resource] ?? 0));
      return Math.floor(available / Math.max(1, amount));
    });
    let quantity = limits.length ? Math.min(...limits) : Math.max(1, Math.floor(cap));
    quantity = Math.min(Math.max(0, quantity), Math.max(1, Math.min(99, Math.floor(cap))));
    if (recipe.projectOnly) quantity = Math.min(quantity, projectRemainingUnits(state, recipeId, recipe));
    return {
      ok: quantity > 0,
      quantity,
      reason: quantity > 0 ? null : '未予約の資源では追加生産できません。',
      committed
    };
  }

  enqueue(state, buildingId, recipeId, quantity = 1) {
    const building = state.civilization.buildings.find(item => item.id === buildingId);
    const recipe = PRODUCTION_RECIPES[recipeId];
    if (!compatible(state, building, recipeId, recipe)) return { ok: false, reason: 'この施設では生産できません。' };
    let amount = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
    if (recipe.projectOnly) {
      amount = Math.min(amount, projectRemainingUnits(state, recipeId, recipe));
      if (amount <= 0) return { ok: false, reason: '発展計画に必要な生産量はすでに予約済みです。' };
    }
    const queue = queueFor(state, buildingId, true);
    queue.orders.push({ id: stableId('order', buildingId, recipeId, state.runtime?.worldTimeMs ?? Date.now(), queue.orders.length), recipeId, remaining: amount });
    this.startNext(state, queue, building);
    return { ok: true, queue, quantity: amount };
  }

  startNext(state, queue, building) {
    while (queue.orders.length && queue.orders[0].remaining <= 0) queue.orders.shift();
    const order = queue.orders[0];
    if (queue.current || !order) return false;
    const recipe = PRODUCTION_RECIPES[order.recipeId];
    if (!queuedOrderCompatible(state, building, recipe)) return false;
    if (!hasBundle(state, recipe.input)) {
      queue.waitingForResources = true;
      return false;
    }
    consumeBundle(state, recipe.input);
    queue.waitingForResources = false;
    queue.current = {
      recipeId: order.recipeId,
      orderId: order.id,
      elapsedSec: 0,
      durationSec: recipe.seconds,
      reservedInput: deepClone(recipe.input)
    };
    return true;
  }

  completeCurrent(state, queue, building) {
    const current = queue.current;
    const recipe = PRODUCTION_RECIPES[current.recipeId];
    const order = queue.orders.find(item => item.id === current.orderId);
    const result = recipe.projectOnly
      ? { accepted: {}, overflowed: {} }
      : addBundle(state, recipe.output);
    if (recipe.projectOnly) {
      const project = state.civilization.project;
      project.contributions ??= {};
      for (const [resource, amount] of Object.entries(recipe.output)) {
        const definition = CIVILIZATION_PROJECTS[project.targetLevel];
        const required = definition?.contributions?.[resource] ?? 0;
        const accepted = Math.max(0, Math.min(amount, required - (project.contributions[resource] ?? 0)));
        project.contributions[resource] = (project.contributions[resource] ?? 0) + accepted;
        result.accepted[resource] = accepted;
      }
    }
    for (const [resource, amount] of Object.entries(result.overflowed)) {
      const overflow = state.inventory.overflow[resource];
      if (overflow) {
        overflow.amount -= amount;
        if (overflow.amount <= 0) delete state.inventory.overflow[resource];
      }
      building.outputBuffer[resource] = (building.outputBuffer[resource] ?? 0) + amount;
    }
    if (order) order.remaining -= 1;
    queue.completedUnits += 1;
    building.history.produced += Object.values(recipe.output).reduce((sum, value) => sum + value, 0);
    for (const [key, value] of Object.entries(recipe.output)) {
      state.civilization.progress.totalProduced[key] = (state.civilization.progress.totalProduced[key] ?? 0) + value;
    }
    if (recipe.output.bronzeIngot) state.civilization.progress.selfProducedBronze += recipe.output.bronzeIngot;
    if (recipe.output.wroughtIron) state.civilization.progress.selfProducedWroughtIron += recipe.output.wroughtIron;
    if (recipe.output.steel) state.civilization.progress.selfProducedSteel = (state.civilization.progress.selfProducedSteel ?? 0) + recipe.output.steel;
    if (recipe.output.mechanism) state.civilization.progress.selfProducedMechanism = (state.civilization.progress.selfProducedMechanism ?? 0) + recipe.output.mechanism;
    queue.current = null;
    while (queue.orders.length && queue.orders[0].remaining <= 0) queue.orders.shift();
    this.events?.emit('civilization:produced', { buildingId: building.id, recipeId: current.recipeId, output: recipe.output, overflowed: result.overflowed });
    this.startNext(state, queue, building);
  }

  update(state, deltaSeconds) {
    let remaining = Math.max(0, deltaSeconds);
    let guard = 0;
    while (remaining > 0.0001 && guard < 1000) {
      guard += 1;
      const active = [];
      let step = remaining;
      for (const queue of state.civilization.productionQueues) {
        const building = state.civilization.buildings.find(item => item.id === queue.buildingId);
        if (!building || building.hp <= 0) continue;
        if (!queue.current) this.startNext(state, queue, building);
        if (!queue.current) continue;
        active.push({ queue, building });
        step = Math.min(step, Math.max(0.001, queue.current.durationSec - queue.current.elapsedSec));
      }
      if (active.length === 0) break;
      for (const item of active) item.queue.current.elapsedSec += step;
      remaining -= step;
      for (const item of active) {
        if (item.queue.current && item.queue.current.elapsedSec + 1e-6 >= item.queue.current.durationSec) {
          this.completeCurrent(state, item.queue, item.building);
        }
      }
    }
  }

  collectOutput(state, buildingId) {
    const building = state.civilization.buildings.find(item => item.id === buildingId);
    if (!building) return { ok: false, reason: '施設が見つかりません。' };
    const buffered = { ...(building.outputBuffer ?? {}) };
    if (Object.values(buffered).every(value => !value)) return { ok: false, reason: '回収できる生産物はありません。' };
    building.outputBuffer = {};
    const result = addBundle(state, buffered);
    for (const [resource, amount] of Object.entries(result.overflowed)) {
      const overflow = state.inventory.overflow[resource];
      if (overflow) {
        overflow.amount -= amount;
        if (overflow.amount <= 0) delete state.inventory.overflow[resource];
      }
      building.outputBuffer[resource] = (building.outputBuffer[resource] ?? 0) + amount;
    }
    return { ok: true, ...result, remaining: { ...building.outputBuffer } };
  }

  missingForNext(state, buildingId) {
    const queue = queueFor(state, buildingId, false);
    const recipe = PRODUCTION_RECIPES[queue?.orders?.[0]?.recipeId];
    return recipe ? missingBundle(state, recipe.input) : {};
  }
}
