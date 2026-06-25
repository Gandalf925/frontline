import { MAJOR_BASE_BUILD_RANGE_METERS } from '../base/construction-range.js';
export const CITY_RECOVERY_DELAY_SECONDS = 75;
export const CITY_RECOVERY_HP_PER_SECOND = 0.12;

import { DEFENSE_LINES, ENEMY_DROPS, defenseLineForType, defenseTierDefinition } from '../civilization/data.js';

export const BUILD_RANGE_METERS = MAJOR_BASE_BUILD_RANGE_METERS;
export const MAX_ENEMIES = 960;

export const ENEMY_DEFINITIONS = Object.freeze({
  infantry: {
    name: '歩兵', hp: 50, speed: 1.2, cityDamage: 8, barrierDps: 2, radius: 4.5, drops: ENEMY_DROPS.infantry,
    personality: 'direct', barrierStrategy: 'balanced', barrierCostFactor: 1.05, routeLabel: '最短進軍', objectiveLabel: '都市'
  },
  scout: {
    name: '斥候', hp: 25, speed: 1.75, cityDamage: 4, barrierDps: 1, radius: 3.7, drops: ENEMY_DROPS.scout,
    personality: 'evasive', avoidTowers: true, barrierStrategy: 'avoid', barrierCostFactor: 2.8, routeLabel: '危険回避', objectiveLabel: '都市'
  },
  shield: {
    name: '盾兵', hp: 100, speed: 0.95, cityDamage: 8, barrierDps: 2, radius: 5.4, drops: ENEMY_DROPS.shield, shieldAura: 0.30,
    personality: 'guardian', barrierStrategy: 'balanced', barrierCostFactor: 0.9, routeLabel: '護衛進軍', objectiveLabel: '都市'
  },
  engineer: {
    name: '工兵', hp: 60, speed: 1.0, cityDamage: 5, barrierDps: 8, radius: 4.7, drops: ENEMY_DROPS.engineer,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.42, routeLabel: '防壁突破', objectiveLabel: '都市'
  },
  heavy: {
    name: '重装兵', hp: 180, speed: 0.7, cityDamage: 20, barrierDps: 6, radius: 6.5, drops: ENEMY_DROPS.heavy, slowResistance: 0.5,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.78, routeLabel: '正面突破', objectiveLabel: '都市'
  },
  raider: {
    name: '破壊工作員', hp: 55, speed: 1.3, cityDamage: 6, barrierDps: 3, radius: 4.9, drops: ENEMY_DROPS.raider,
    personality: 'saboteur', barrierStrategy: 'avoid', barrierCostFactor: 2.0, routeLabel: '施設潜入', objectiveLabel: '支援・火力施設',
    targetPriorities: ['medical', 'fieldBarracks', 'relay', 'mortar', 'gun', 'slow'], facilitySearchRadius: 420, facilityDps: 12, stunSeconds: 8,
    attackMessage: '破壊工作員が防衛施設を停止させました。'
  },
  archer: {
    name: '弓兵', hp: 45, speed: 1.05, cityDamage: 7, barrierDps: 1, radius: 4, drops: { wood: 2, fiber: 4 }, generation: 1,
    personality: 'evasive', avoidTowers: true, barrierStrategy: 'avoid', barrierCostFactor: 2.4, routeLabel: '射線回避', objectiveLabel: '都市'
  },
  ropeCutter: {
    name: '縄切り兵', hp: 65, speed: 1.1, cityDamage: 6, barrierDps: 5, radius: 4.5, drops: { wood: 2, stone: 1, fiber: 3 }, generation: 1,
    personality: 'saboteur', barrierStrategy: 'balanced', barrierCostFactor: 0.9, routeLabel: '妨害排除', objectiveLabel: '減速・修復施設',
    targetPriorities: ['slow', 'relay'], facilitySearchRadius: 360, facilityPriorityPenaltySeconds: 120, facilityDps: 10,
    attackMessage: '縄切り兵が妨害施設を破壊しています。'
  },
  pathfinder: {
    name: '迂回斥候', hp: 34, speed: 1.65, cityDamage: 5, barrierDps: 1.2, radius: 3.9, drops: { wood: 1, fiber: 4 }, generation: 1,
    personality: 'flanker', avoidTowers: true, avoidCongestion: true, barrierStrategy: 'avoid', barrierCostFactor: 3.1,
    flankPreference: 3.8, flankWidthMeters: 145, maxDetourRatio: 1.70, minimumLateralMeters: 35,
    routeLabel: '大迂回', objectiveLabel: '都市・簡易拠点', cityPriorityPenalty: 10, fieldBasePriorityPenalty: 4
  },
  marauder: {
    name: '略奪兵', hp: 72, speed: 1.22, cityDamage: 8, barrierDps: 3, radius: 4.8, drops: { wood: 3, stone: 1, fiber: 3 }, generation: 1,
    personality: 'marauder', avoidCongestion: true, barrierStrategy: 'balanced', barrierCostFactor: 1.1,
    routeLabel: '拠点襲撃', objectiveLabel: '簡易拠点', cityPriorityPenalty: 50, fieldBasePriorityPenalty: 0
  },
  miner: {
    name: '採掘兵', hp: 85, speed: 0.9, cityDamage: 8, barrierDps: 4, radius: 5, drops: { stone: 3, copperOre: 1 }, generation: 2,
    personality: 'direct', barrierStrategy: 'balanced', barrierCostFactor: 1.0, routeLabel: '資源護送', objectiveLabel: '都市'
  },
  siegeBreaker: {
    name: '破城兵', hp: 145, speed: 0.72, cityDamage: 18, barrierDps: 12, settlementDamage: 18, radius: 6, drops: { stone: 5, charcoal: 1 }, generation: 2,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.3, routeLabel: '防壁最優先', objectiveLabel: '都市'
  },
  oreCarrier: {
    name: '鉱石運搬兵', hp: 70, speed: 1.2, cityDamage: 5, barrierDps: 2, radius: 4.8, drops: { stone: 2, copperOre: 1, tinOre: 1 }, generation: 2,
    personality: 'evasive', barrierStrategy: 'avoid', barrierCostFactor: 1.8, routeLabel: '護送迂回', objectiveLabel: '都市'
  },
  sapper: {
    name: '爆破工兵', hp: 82, speed: 0.88, cityDamage: 7, barrierDps: 18, radius: 5.1, drops: { stone: 4, charcoal: 2 }, generation: 2,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.12, routeLabel: '爆破突破', objectiveLabel: '防壁・都市'
  },
  pillager: {
    name: '資源略奪兵', hp: 105, speed: 1.02, cityDamage: 11, barrierDps: 4, radius: 5.3, drops: { wood: 3, stone: 3, copperOre: 1 }, generation: 2,
    personality: 'marauder', avoidCongestion: true, barrierStrategy: 'balanced', barrierCostFactor: 1.0,
    routeLabel: '前線略奪', objectiveLabel: '簡易拠点・支援施設', cityPriorityPenalty: 42, fieldBasePriorityPenalty: 0,
    targetPriorities: ['survey', 'relay', 'fieldBarracks', 'medical'], facilitySearchRadius: 460, facilityDps: 13,
    attackMessage: '資源略奪兵が前線支援施設を破壊しています。'
  },
  bronzeShield: {
    name: '青銅盾兵', hp: 170, speed: 0.78, cityDamage: 14, barrierDps: 4, radius: 6, drops: { stone: 4, bronzeIngot: 1 }, generation: 3, shieldAura: 0.35,
    personality: 'guardian', barrierStrategy: 'balanced', barrierCostFactor: 0.72, routeLabel: '重護衛進軍', objectiveLabel: '都市'
  },
  siegeCaptain: {
    name: '攻城隊長', hp: 270, speed: 0.62, cityDamage: 30, barrierDps: 16, settlementDamage: 24, radius: 7, drops: { charcoal: 3, bronzeIngot: 2 }, generation: 3, slowResistance: 0.35,
    personality: 'commander', barrierStrategy: 'breach', barrierCostFactor: 0.24, routeLabel: '攻城指揮', objectiveLabel: '重火力施設',
    targetPriorities: ['mortar', 'gun'], facilitySearchRadius: 500, facilityDps: 16, speedAura: 0.10, auraRange: 32,
    attackMessage: '攻城隊長が火力施設へ攻撃を集中しています。'
  },
  ironCarrier: {
    name: '鉄鉱運搬兵', hp: 115, speed: 1.0, cityDamage: 9, barrierDps: 4, radius: 5.2, drops: { stone: 3, ironOre: 2 }, generation: 3,
    personality: 'evasive', barrierStrategy: 'avoid', barrierCostFactor: 1.55, routeLabel: '護送迂回', objectiveLabel: '都市'
  },
  flankRider: {
    name: '側面騎兵', hp: 145, speed: 1.8, cityDamage: 16, barrierDps: 3, radius: 5.8, drops: { fiber: 4, bronzeIngot: 1 }, generation: 3, slowResistance: 0.25,
    personality: 'flanker', avoidTowers: true, avoidCongestion: true, barrierStrategy: 'avoid', barrierCostFactor: 3.4,
    flankPreference: 4.4, flankWidthMeters: 190, maxDetourRatio: 1.85, minimumLateralMeters: 55,
    routeLabel: '長距離側面攻撃', objectiveLabel: '都市・簡易拠点', cityPriorityPenalty: 8, fieldBasePriorityPenalty: 2
  },
  warDrummer: {
    name: '戦鼓兵', hp: 135, speed: 0.95, cityDamage: 9, barrierDps: 3, radius: 5.4, drops: { wood: 3, fiber: 4, bronzeIngot: 1 }, generation: 3,
    personality: 'support', barrierStrategy: 'balanced', barrierCostFactor: 1.0, routeLabel: '主力同行', objectiveLabel: '周辺部隊支援',
    speedAura: 0.14, auraRange: 42
  },
  ironclad: {
    name: '鉄甲兵', hp: 330, speed: 0.55, cityDamage: 36, barrierDps: 10, radius: 7.2, drops: { ironOre: 3, wroughtIron: 1 }, generation: 4, slowResistance: 0.65,
    personality: 'guardian', barrierStrategy: 'breach', barrierCostFactor: 0.5, routeLabel: '鉄甲突破', objectiveLabel: '都市'
  },
  heavySiege: {
    name: '重攻城兵', hp: 460, speed: 0.42, cityDamage: 50, barrierDps: 24, settlementDamage: 36, radius: 8, drops: { ironOre: 4, wroughtIron: 1 }, generation: 4, slowResistance: 0.5,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.16, routeLabel: '防壁粉砕', objectiveLabel: '都市'
  },
  commander: {
    name: '指揮官', hp: 310, speed: 0.75, cityDamage: 25, barrierDps: 8, radius: 7, drops: { bronzeIngot: 2, wroughtIron: 2 }, generation: 4,
    personality: 'commander', commanderAura: 0.18, speedAura: 0.18, auraRange: 35,
    barrierStrategy: 'balanced', barrierCostFactor: 0.68, routeLabel: '部隊統制', objectiveLabel: '都市'
  },
  squadHunter: {
    name: '部隊狩り', hp: 220, speed: 1.34, cityDamage: 15, barrierDps: 5, radius: 6, drops: { ironOre: 2, bronzeIngot: 1 }, generation: 4, slowResistance: 0.3,
    personality: 'hunter', huntFriendlySquads: true, huntRadius: 650, avoidCongestion: true, barrierStrategy: 'balanced', barrierCostFactor: 0.95,
    routeLabel: '味方部隊追跡', objectiveLabel: '道路上の味方部隊', cityPriorityPenalty: 60, fieldBasePriorityPenalty: 35
  },
  ironSaboteur: {
    name: '重破壊工作員', hp: 265, speed: 0.9, cityDamage: 20, barrierDps: 8, radius: 6.3, drops: { ironOre: 2, wroughtIron: 1 }, generation: 4, slowResistance: 0.35,
    personality: 'saboteur', avoidTowers: true, barrierStrategy: 'avoid', barrierCostFactor: 2.1,
    routeLabel: '後方施設破壊', objectiveLabel: '治療・修復・火力施設',
    targetPriorities: ['medical', 'fieldBarracks', 'relay', 'mortar', 'gun', 'slow', 'survey'], facilitySearchRadius: 560, facilityDps: 22, stunSeconds: 12,
    attackMessage: '重破壊工作員が後方施設を機能停止させました。'
  },
  bodyguard: {
    name: '鉄衛兵', hp: 390, speed: 0.62, cityDamage: 24, barrierDps: 10, radius: 7.4, drops: { ironOre: 3, wroughtIron: 1 }, generation: 4, slowResistance: 0.55, shieldAura: 0.42,
    personality: 'guardian', barrierStrategy: 'breach', barrierCostFactor: 0.62, routeLabel: '精鋭護衛', objectiveLabel: '指揮・攻城部隊の護衛'
  },
  steelGuard: {
    name: '鋼装衛兵', hp: 480, speed: 0.58, cityDamage: 32, barrierDps: 12, radius: 7.8, drops: { wroughtIron: 2, steel: 1 }, generation: 5, slowResistance: 0.68, shieldAura: 0.46,
    personality: 'guardian', barrierStrategy: 'breach', barrierCostFactor: 0.55, routeLabel: '鋼装護衛', objectiveLabel: '指揮・破城部隊の護衛'
  },
  demolitionEngineer: {
    name: '破砕工兵', hp: 340, speed: 0.72, cityDamage: 34, barrierDps: 30, settlementDamage: 42, radius: 6.8, drops: { wroughtIron: 2, steel: 1 }, generation: 5, slowResistance: 0.42,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.10, routeLabel: '鋼鉄破砕', objectiveLabel: '防壁・門・都市'
  },
  pursuitCavalry: {
    name: '追撃騎兵', hp: 260, speed: 1.55, cityDamage: 22, barrierDps: 5, radius: 6.2, drops: { fiber: 5, steel: 1 }, generation: 5, slowResistance: 0.38,
    personality: 'hunter', huntFriendlySquads: true, huntRadius: 850, avoidCongestion: true, barrierStrategy: 'avoid', barrierCostFactor: 1.8, routeLabel: '高速追撃', objectiveLabel: '道路上の味方部隊'
  },
  steelCaptain: {
    name: '鋼鉄隊長', hp: 430, speed: 0.76, cityDamage: 34, barrierDps: 12, radius: 7.2, drops: { steel: 2, wroughtIron: 2 }, generation: 5,
    personality: 'commander', commanderAura: 0.22, speedAura: 0.14, auraRange: 44, barrierStrategy: 'balanced', barrierCostFactor: 0.62, routeLabel: '鋼鉄部隊統制', objectiveLabel: '都市'
  },
  mobileLancer: {
    name: '機動槍兵', hp: 330, speed: 1.48, cityDamage: 30, barrierDps: 7, radius: 6.5, drops: { steel: 1, mechanism: 1 }, generation: 6, slowResistance: 0.42,
    personality: 'flanker', avoidTowers: true, avoidCongestion: true, barrierStrategy: 'avoid', barrierCostFactor: 3.6, flankPreference: 4.8, flankWidthMeters: 230, maxDetourRatio: 1.95, minimumLateralMeters: 65, routeLabel: '機動側面攻撃', objectiveLabel: '都市・簡易拠点'
  },
  mechanicalSiege: {
    name: '機構破城兵', hp: 620, speed: 0.48, cityDamage: 62, barrierDps: 38, settlementDamage: 55, radius: 8.6, drops: { steel: 2, mechanism: 1 }, generation: 6, slowResistance: 0.62,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.08, routeLabel: '機構破城', objectiveLabel: '門・主要拠点'
  },
  armoredAgent: {
    name: '装甲工作員', hp: 390, speed: 0.96, cityDamage: 28, barrierDps: 10, radius: 6.7, drops: { steel: 1, mechanism: 1 }, generation: 6, slowResistance: 0.45,
    personality: 'saboteur', avoidTowers: true, barrierStrategy: 'avoid', barrierCostFactor: 2.4, routeLabel: '支援網破壊', objectiveLabel: '回復・修復・兵舎', targetPriorities: ['medical', 'relay', 'fieldBarracks', 'survey'], facilitySearchRadius: 650, facilityDps: 30, stunSeconds: 15,
    attackMessage: '装甲工作員が前線支援網を停止させました。'
  },
  machineCommander: {
    name: '戦列指揮官', hp: 520, speed: 0.82, cityDamage: 40, barrierDps: 13, radius: 7.5, drops: { steel: 2, mechanism: 2 }, generation: 6,
    personality: 'commander', commanderAura: 0.26, speedAura: 0.20, auraRange: 52, barrierStrategy: 'balanced', barrierCostFactor: 0.58, routeLabel: '機械化戦列', objectiveLabel: '都市'
  },
  royalGuard: {
    name: '親衛重装兵', hp: 760, speed: 0.52, cityDamage: 48, barrierDps: 18, radius: 9, drops: { steel: 3, mechanism: 2 }, generation: 7, slowResistance: 0.78, shieldAura: 0.52,
    personality: 'guardian', barrierStrategy: 'breach', barrierCostFactor: 0.42, routeLabel: '親衛護衛', objectiveLabel: '総司令官の護衛'
  },
  fortressBreaker: {
    name: '城塞破砕兵', hp: 880, speed: 0.40, cityDamage: 85, barrierDps: 52, settlementDamage: 70, radius: 9.4, drops: { steel: 3, mechanism: 2 }, generation: 7, slowResistance: 0.70,
    personality: 'breacher', barrierStrategy: 'breach', barrierCostFactor: 0.05, routeLabel: '城塞破砕', objectiveLabel: '城塞防壁・主要拠点'
  },
  roadHunter: {
    name: '道路狩猟隊', hp: 440, speed: 1.42, cityDamage: 34, barrierDps: 8, radius: 7, drops: { steel: 2, mechanism: 1 }, generation: 7, slowResistance: 0.48,
    personality: 'hunter', huntFriendlySquads: true, huntRadius: 1100, avoidCongestion: true, barrierStrategy: 'balanced', barrierCostFactor: 1.0, routeLabel: '道路網狩猟', objectiveLabel: '味方部隊・前線拠点'
  },
  royalCommander: {
    name: '総司令官', hp: 920, speed: 0.68, cityDamage: 72, barrierDps: 22, radius: 9.2, drops: { steel: 4, mechanism: 3 }, generation: 7, slowResistance: 0.60,
    personality: 'commander', commanderAura: 0.34, speedAura: 0.25, shieldAura: 0.20, auraRange: 62, barrierStrategy: 'breach', barrierCostFactor: 0.45, routeLabel: '連邦侵攻指揮', objectiveLabel: '統合司令府'
  }
});

export const ENEMY_GENERATIONS = Object.freeze({
  0: ['infantry', 'scout', 'shield', 'engineer', 'heavy', 'raider'],
  1: ['archer', 'ropeCutter', 'pathfinder', 'marauder'],
  2: ['miner', 'siegeBreaker', 'oreCarrier', 'sapper', 'pillager'],
  3: ['bronzeShield', 'siegeCaptain', 'ironCarrier', 'flankRider', 'warDrummer'],
  4: ['ironclad', 'heavySiege', 'commander', 'squadHunter', 'ironSaboteur', 'bodyguard'],
  5: ['steelGuard', 'demolitionEngineer', 'pursuitCavalry', 'steelCaptain'],
  6: ['mobileLancer', 'mechanicalSiege', 'armoredAgent', 'machineCommander'],
  7: ['royalGuard', 'fortressBreaker', 'roadHunter', 'royalCommander']
});

export const ENEMY_BASE_DEFINITIONS = Object.freeze({
  barracks: {
    name: '前哨基地', icon: '⚑', interval: 180, firstDelay: 90, range: [160, 240], reward: { wood: 40, stone: 20, fiber: 20 },
    waves: { 1: ['infantry', 'infantry', 'scout'], 2: ['infantry', 'infantry', 'infantry', 'shield'], 3: ['infantry', 'infantry', 'infantry', 'infantry', 'scout', 'shield'] }
  },
  engineer: {
    name: '工兵拠点', icon: '⚒', interval: 300, firstDelay: 150, range: [260, 380], reward: { wood: 45, stone: 45, fiber: 20 },
    waves: { 1: ['engineer', 'infantry', 'infantry'], 2: ['engineer', 'shield', 'infantry', 'infantry'], 3: ['engineer', 'engineer', 'shield', 'infantry', 'infantry'] }
  },
  raider: {
    name: '工作員拠点', icon: '✦', interval: 360, firstDelay: 180, range: [260, 420], reward: { wood: 40, stone: 20, fiber: 70 },
    waves: { 1: ['raider', 'scout'], 2: ['raider', 'raider', 'scout'], 3: ['raider', 'raider', 'engineer', 'scout'] }
  },
  copperCamp: {
    name: '銅鉱野営地', icon: 'Cu', interval: 420, firstDelay: 180, range: [300, 650], reward: { copperOre: 120, stone: 20 }, isResourceBase: true,
    waves: { 1: ['miner', 'oreCarrier'], 2: ['miner', 'miner', 'oreCarrier', 'shield'], 3: ['siegeBreaker', 'miner', 'oreCarrier', 'oreCarrier'] }
  },
  tinCamp: {
    name: '錫鉱野営地', icon: 'Sn', interval: 480, firstDelay: 220, range: [350, 700], reward: { tinOre: 32, stone: 20 }, isResourceBase: true,
    waves: { 1: ['miner', 'oreCarrier'], 2: ['miner', 'oreCarrier', 'ropeCutter'], 3: ['siegeBreaker', 'miner', 'oreCarrier', 'ropeCutter'] }
  },
  ironCamp: {
    name: '鉄鉱野営地', icon: 'Fe', interval: 540, firstDelay: 240, range: [400, 800], reward: { ironOre: 128, stone: 30 }, isResourceBase: true,
    waves: { 1: ['ironCarrier', 'bronzeShield'], 2: ['ironCarrier', 'ironCarrier', 'bronzeShield'], 3: ['siegeCaptain', 'ironCarrier', 'bronzeShield'] }
  },
  bronzeCamp: {
    name: '青銅軍営', icon: 'Bz', interval: 600, firstDelay: 280, range: [450, 850], reward: { bronzeIngot: 12, charcoal: 20 }, isResourceBase: true,
    waves: { 1: ['bronzeShield', 'archer'], 2: ['bronzeShield', 'bronzeShield', 'siegeBreaker'], 3: ['siegeCaptain', 'bronzeShield', 'archer'] }
  },
  siegeWorks: {
    name: '攻城兵器工房', icon: '⚒', interval: 720, firstDelay: 320, range: [500, 950], reward: { wroughtIron: 8, charcoal: 24 }, isResourceBase: true,
    waves: { 1: ['siegeBreaker', 'miner'], 2: ['siegeBreaker', 'bronzeShield', 'ropeCutter'], 3: ['siegeCaptain', 'siegeBreaker', 'bronzeShield'] }
  },
  motor: {
    name: '装甲工場', icon: '⬢', interval: 420, firstDelay: 240, range: [420, 550], reward: { wood: 30, stone: 100, fiber: 30 },
    waves: { 1: ['heavy', 'infantry', 'infantry'], 2: ['heavy', 'shield', 'infantry', 'infantry'], 3: ['heavy', 'heavy', 'shield', 'scout'] }
  },
  steelCamp: {
    name: '製鋼軍営', icon: 'St', interval: 660, firstDelay: 360, range: [650, 1100], reward: { steel: 14, wroughtIron: 16, charcoal: 30 }, isResourceBase: true,
    waves: { 1: ['steelGuard', 'demolitionEngineer'], 2: ['steelGuard', 'pursuitCavalry', 'steelCaptain'], 3: ['steelCaptain', 'steelGuard', 'demolitionEngineer', 'pursuitCavalry'] }
  },
  machineWorks: {
    name: '機械工廠', icon: 'Mc', interval: 720, firstDelay: 420, range: [750, 1250], reward: { mechanism: 10, steel: 18 }, isResourceBase: true,
    waves: { 1: ['mobileLancer', 'armoredAgent'], 2: ['mechanicalSiege', 'mobileLancer', 'machineCommander'], 3: ['machineCommander', 'mechanicalSiege', 'armoredAgent', 'mobileLancer'] }
  },
  commandFortress: {
    name: '司令要塞', icon: 'HQ', interval: 780, firstDelay: 480, range: [900, 1500], reward: { mechanism: 16, steel: 24 }, isResourceBase: true,
    waves: { 1: ['royalGuard', 'roadHunter'], 2: ['fortressBreaker', 'royalGuard', 'royalCommander'], 3: ['royalCommander', 'fortressBreaker', 'royalGuard', 'roadHunter'] }
  }
});

const ICONS = Object.freeze({ barrier: '▰', gun: '⌁', mortar: '◉', slow: '◌', relay: '⚒', survey: '⌖', medical: '✚', fieldBarracks: '▣' });
const KINDS = Object.freeze({ barrier: 'barrier', gun: 'tower', mortar: 'tower', slow: 'tower', relay: 'tower', survey: 'tower', medical: 'tower', fieldBarracks: 'tower' });
const INITIAL_TIERS = Object.freeze({ survey: 1, medical: 1, fieldBarracks: 1 });

export const DEFENSE_DEFINITIONS = Object.freeze(Object.fromEntries(
  ['barrier', 'gun', 'mortar', 'slow', 'relay', 'survey', 'medical', 'fieldBarracks'].map(type => {
    const initialTier = INITIAL_TIERS[type] ?? 0;
    const tier = defenseTierDefinition(type, initialTier);
    return [type, Object.freeze({
      type,
      line: defenseLineForType(type),
      name: tier.name,
      icon: ICONS[type],
      kind: KINDS[type],
      initialTier,
      requiredCivilizationLevel: initialTier,
      allowedAnchorKinds: type === 'survey' ? ['MAJOR', 'FIELD', 'EXPEDITION'] : type === 'medical' ? ['MAJOR', 'FIELD', 'EXPEDITION'] : type === 'fieldBarracks' ? ['FIELD'] : null,
      limitPerAnchor: ['survey', 'medical', 'fieldBarracks'].includes(type) ? 1 : null,
      cost: tier.cost,
      hp: tier.hp,
      range: tier.range,
      damage: tier.damage,
      cooldown: tier.cooldown,
      blastRadius: tier.blastRadius,
      maxTargets: tier.maxTargets,
      splashMultiplier: tier.splashMultiplier,
      slowSeconds: tier.duration,
      slow: tier.slow,
      repairTower: tier.repairTower,
      repairBarrier: tier.repairBarrier,
      surveyRadius: tier.surveyRadius,
      scanInterval: tier.scanInterval,
      recoveryRate: tier.recoveryRate,
      squadCapacityBonus: tier.squadCapacityBonus
    })];
  })
));

export function defenseRuntimeDefinition(defense) {
  const line = defense.isGate ? 'gate' : defense.line ?? defenseLineForType(defense.type);
  const fallback = DEFENSE_DEFINITIONS[defense.type];
  const base = DEFENSE_LINES[line]?.[defense.tier ?? 0] ?? fallback;
  return {
    ...fallback,
    ...base,
    hp: Math.max(1, Number(defense.maxHp) || Number(base?.hp) || Number(fallback?.hp) || 1),
    slowSeconds: base?.duration ?? fallback?.slowSeconds,
    blastRadius: base?.blastRadius ?? fallback?.blastRadius,
    maxTargets: base?.maxTargets ?? fallback?.maxTargets,
    splashMultiplier: base?.splashMultiplier ?? fallback?.splashMultiplier,
    surveyRadius: base?.surveyRadius ?? fallback?.surveyRadius,
    scanInterval: base?.scanInterval ?? fallback?.scanInterval,
    recoveryRate: base?.recoveryRate ?? fallback?.recoveryRate,
    squadCapacityBonus: base?.squadCapacityBonus ?? fallback?.squadCapacityBonus
  };
}
