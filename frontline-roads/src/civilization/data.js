export const MAX_CIVILIZATION_LEVEL = 7;

export const BASE_RESOURCES = Object.freeze(['wood', 'stone', 'fiber']);
export const ORE_RESOURCES = Object.freeze(['copperOre', 'tinOre', 'ironOre']);
export const PROCESSED_RESOURCES = Object.freeze([
  'timber', 'rope', 'cutStone', 'charcoal', 'copperIngot', 'tinIngot',
  'bronzeIngot', 'ironBloom', 'wroughtIron', 'steel', 'mechanism'
]);
export const RESOURCE_KEYS = Object.freeze([...BASE_RESOURCES, ...ORE_RESOURCES, ...PROCESSED_RESOURCES]);

export const RESOURCE_LABELS = Object.freeze({
  wood: '木材', stone: '石材', fiber: '繊維',
  copperOre: '銅鉱石', tinOre: '錫鉱石', ironOre: '鉄鉱石',
  timber: '加工木材', rope: '縄', cutStone: '切石', charcoal: '木炭',
  copperIngot: '銅塊', tinIngot: '錫塊', bronzeIngot: '青銅塊',
  ironBloom: '鉄塊', wroughtIron: '鍛鉄', steel: '鋼材', mechanism: '機構部品'
});

export const INITIAL_RESOURCES = Object.freeze({ wood: 150, stone: 100, fiber: 70 });

export const CIVILIZATIONS = Object.freeze([
  { level: 0, name: '原始集落', central: '中央焚火', slots: 2, graceMinutes: 0, capacity: { base: 300, processed: 0, ore: 0, metal: 0 }, unlocks: ['barrier0', 'single0', 'area0', 'slow0', 'repair0'] },
  { level: 1, name: '定住集落', central: '集会小屋', slots: 5, graceMinutes: 15, capacity: { base: 800, processed: 200, ore: 0, metal: 0 }, unlocks: ['storehouse1', 'carpentry', 'ropeworks', 'stonecutter', 'barrier1', 'single1', 'area1', 'slow1', 'repair1', 'survey1', 'medical1', 'fieldBarracks1'] },
  { level: 2, name: '石工集落', central: '石造集会所', slots: 10, graceMinutes: 15, capacity: { base: 1500, processed: 500, ore: 300, metal: 300 }, unlocks: ['storehouse2', 'charcoalKiln', 'copperFurnace', 'tinFurnace', 'trialBronzeFurnace', 'barrier2', 'gate2', 'single2', 'area2', 'slow2', 'repair2', 'survey2', 'medical2', 'fieldBarracks2'] },
  { level: 3, name: '青銅砦', central: '青銅の砦', slots: 14, graceMinutes: 15, capacity: { base: 3000, processed: 1000, ore: 500, metal: 500 }, unlocks: ['storehouse3', 'bronzeWorkshop', 'bloomery', 'forge', 'barrier3', 'gate3', 'single3', 'area3', 'slow3', 'repair3', 'survey3', 'medical3', 'fieldBarracks3'] },
  { level: 4, name: '鉄器都市', central: '鉄の城館', slots: 16, graceMinutes: 0, capacity: { base: 6000, processed: 2000, ore: 1000, metal: 1000 }, unlocks: ['storehouse4', 'barrier4', 'gate4', 'single4', 'area4', 'slow4', 'repair4', 'survey4', 'medical4', 'fieldBarracks4'] },
  { level: 5, name: '鋼鉄城塞', central: '鋼鉄本丸', slots: 19, graceMinutes: 20, capacity: { base: 9000, processed: 3200, ore: 1500, metal: 1800 }, unlocks: ['steelStorehouse', 'steelworks', 'barrier5', 'gate5', 'single5', 'area5', 'slow5', 'repair5', 'survey5', 'medical5', 'fieldBarracks5'] },
  { level: 6, name: '機械都市', central: '機関司令庁', slots: 22, graceMinutes: 20, capacity: { base: 13000, processed: 5000, ore: 2200, metal: 3000 }, unlocks: ['mechanismStorehouse', 'mechanismWorkshop', 'barrier6', 'gate6', 'single6', 'area6', 'slow6', 'repair6', 'survey6', 'medical6', 'fieldBarracks6'] },
  { level: 7, name: '街道連邦', central: '統合司令府', slots: 25, graceMinutes: 30, capacity: { base: 18000, processed: 7500, ore: 3200, metal: 4500 }, unlocks: ['federalStorehouse', 'integratedWorks', 'barrier7', 'gate7', 'single7', 'area7', 'slow7', 'repair7', 'survey7', 'medical7', 'fieldBarracks7'] }
]);

export const CIVILIZATION_PROJECTS = Object.freeze({
  1: { target: 1, durationSec: 600, artifactsRequired: 1, contributions: { wood: 25, stone: 35, fiber: 8 }, buildings: { barrier0: 1, single0: 2 }, progress: { totalKills: 20, totalCampsCaptured: 1, cityHpStreak: { threshold: 50, seconds: 300 } } },
  2: { target: 2, durationSec: 1800, artifactsRequired: 2, contributions: { wood: 260, stone: 220, fiber: 120, timber: 24, rope: 12, cutStone: 30 }, buildings: { storehouse1: 1, carpentry: 1, ropeworks: 1, stonecutter: 1, upgradedDefenses: 3, upgradedDefenseKinds: 2 }, progress: { totalKills: 100, totalCampsCaptured: 3, totalRepairHpPaid: 200, totalProduced: 30, cityHpStreak: { threshold: 60, seconds: 900 } } },
  3: { target: 3, durationSec: 7200, artifactsRequired: 4, contributions: { wood: 350, stone: 400, fiber: 180, timber: 40, rope: 20, cutStone: 50, charcoal: 50, bronzeIngot: 24 }, buildings: { storehouse2: 1, charcoalKiln: 1, copperFurnace: 1, tinFurnace: 1, trialBronzeFurnace: 1, barrier2: 3, gate2: 1 }, progress: { totalKills: 250, totalCampsCaptured: 6, copperCampsCaptured: 1, tinCampsCaptured: 1, selfProducedBronze: 24, perfectWaveStreak: 3 } },
  4: { target: 4, durationSec: 28800, artifactsRequired: 7, contributions: { wood: 500, stone: 650, fiber: 250, timber: 60, rope: 30, cutStone: 80, charcoal: 100, bronzeIngot: 40, wroughtIron: 30 }, buildings: { storehouse3: 1, bronzeWorkshop: 1, bloomery: 1, forge: 1, gate3: 1, bronzeDefenses: 4, bronzeDefenseKinds: 3, wallAtLeast2: 4 }, progress: { totalKills: 500, totalCampsCaptured: 12, siegeCaptainsDefeated: 3, ironCampsCaptured: 2, selfProducedWroughtIron: 30, activeFieldBases: 3, perfectWaveStreak: 5, cityHpStreak: { threshold: 70, seconds: 1800 } } },
  5: { target: 5, durationSec: 43200, artifactsRequired: 10, contributions: { wood: 800, stone: 950, fiber: 360, timber: 100, rope: 50, cutStone: 130, charcoal: 180, wroughtIron: 70 }, buildings: { storehouse4: 1, ironDefenses: 8, ironDefenseKinds: 5, gate4: 1 }, progress: { totalKills: 900, totalCampsCaptured: 20, selfProducedWroughtIron: 70, activeFieldBases: 4, perfectWaveStreak: 7, cityHpStreak: { threshold: 70, seconds: 2700 } } },
  6: { target: 6, durationSec: 57600, artifactsRequired: 14, contributions: { wood: 1100, stone: 1300, fiber: 480, timber: 150, rope: 75, cutStone: 180, charcoal: 240, wroughtIron: 90, steel: 60 }, buildings: { steelStorehouse: 1, steelworks: 1, steelDefenses: 10, steelDefenseKinds: 6, gate5: 1 }, progress: { totalKills: 1400, totalCampsCaptured: 30, selfProducedSteel: 60, generation5CommandersDefeated: 4, activeFieldBases: 5, perfectWaveStreak: 9 } },
  7: { target: 7, durationSec: 86400, artifactsRequired: 20, contributions: { wood: 1500, stone: 1800, fiber: 650, timber: 220, rope: 110, cutStone: 260, charcoal: 320, wroughtIron: 120, steel: 100, mechanism: 50 }, buildings: { mechanismStorehouse: 1, mechanismWorkshop: 1, mechanismDefenses: 12, mechanismDefenseKinds: 7, gate6: 1 }, progress: { totalKills: 2200, totalCampsCaptured: 42, selfProducedMechanism: 50, machineWorksCaptured: 1, generation6CommandersDefeated: 5, activeFieldBases: 6, perfectWaveStreak: 12, cityHpStreak: { threshold: 70, seconds: 3600 } } }
});

export const PRODUCTION_RECIPES = Object.freeze({
  timber: { name: '加工木材', building: 'carpentry', input: { wood: 10 }, output: { timber: 1 }, seconds: 60, level: 1 },
  rope: { name: '縄', building: 'ropeworks', input: { fiber: 8 }, output: { rope: 1 }, seconds: 60, level: 1 },
  cutStone: { name: '切石', building: 'stonecutter', input: { stone: 12 }, output: { cutStone: 1 }, seconds: 90, level: 1 },
  charcoal: { name: '木炭', building: 'charcoalKiln', input: { wood: 8 }, output: { charcoal: 1 }, seconds: 120, level: 2 },
  copperIngot: { name: '銅塊', building: 'copperFurnace', input: { copperOre: 6, charcoal: 2 }, output: { copperIngot: 1 }, seconds: 180, level: 2 },
  tinIngot: { name: '錫塊', building: 'tinFurnace', input: { tinOre: 4, charcoal: 2 }, output: { tinIngot: 1 }, seconds: 180, level: 2 },
  trialBronze: { name: '試験青銅', building: 'trialBronzeFurnace', input: { copperIngot: 3, tinIngot: 1, charcoal: 2 }, output: { bronzeIngot: 4 }, seconds: 420, level: 2, projectOnly: true },
  bronzeIngot: { name: '青銅塊', building: 'bronzeWorkshop', input: { copperIngot: 3, tinIngot: 1, charcoal: 2 }, output: { bronzeIngot: 4 }, seconds: 300, level: 3 },
  ironBloom: { name: '鉄塊', building: 'bloomery', input: { ironOre: 8, charcoal: 4 }, output: { ironBloom: 1 }, seconds: 300, level: 3 },
  wroughtIron: { name: '鍛鉄', building: 'forge', input: { ironBloom: 1, charcoal: 2 }, output: { wroughtIron: 1 }, seconds: 240, level: 3 },
  steel: { name: '鋼材', building: 'steelworks', input: { wroughtIron: 2, charcoal: 4 }, output: { steel: 1 }, seconds: 360, level: 5 },
  mechanism: { name: '機構部品', building: 'mechanismWorkshop', input: { steel: 2, timber: 1, rope: 1 }, output: { mechanism: 1 }, seconds: 420, level: 6 },
  integratedSteel: { name: '統合鋼材', building: 'integratedWorks', input: { wroughtIron: 4, charcoal: 6 }, output: { steel: 3 }, seconds: 600, level: 7 },
  integratedMechanism: { name: '統合機構部品', building: 'integratedWorks', input: { steel: 4, timber: 2, rope: 2 }, output: { mechanism: 3 }, seconds: 720, level: 7 }
});

export const SETTLEMENT_BUILDINGS = Object.freeze({
  storehouse1: { name: '簡易倉庫', description: '木材・石材・繊維と初期加工資材の保管上限を増やします。', level: 1, cost: { timber: 8, rope: 3, stone: 20 }, capacityBonus: { base: 400, processed: 100 } },
  carpentry: { name: '木工場', description: '木材を加工木材へ変換します。加工木材は施設や防衛設備の建設・強化に使います。', level: 1, cost: { wood: 80, stone: 30, fiber: 20 } },
  ropeworks: { name: '縄工房', description: '繊維を縄へ加工します。縄は施設建設や部隊・防衛設備の整備に使います。', level: 1, cost: { wood: 50, stone: 20, fiber: 50 } },
  stonecutter: { name: '石切場', description: '石材を切石へ加工します。切石は石造施設と防衛設備の建設・強化に使います。', level: 1, cost: { wood: 45, stone: 70, fiber: 15 } },
  storehouse2: { name: '石造倉庫', description: '基礎資源・加工資材・鉱石・金属の保管上限を大きく増やします。', level: 2, cost: { timber: 15, cutStone: 25, rope: 5 }, capacityBonus: { base: 800, processed: 300, ore: 150, metal: 100 } },
  charcoalKiln: { name: '炭焼き窯', description: '木材を木炭へ加工します。木炭は銅・錫・鉄の精錬に必要です。', level: 2, cost: { cutStone: 12, timber: 6, rope: 2 } },
  copperFurnace: { name: '銅炉', description: '銅鉱石と木炭から銅塊を精錬します。青銅生産の主材料です。', level: 2, cost: { cutStone: 18, timber: 8, charcoal: 10 } },
  tinFurnace: { name: '錫炉', description: '錫鉱石と木炭から錫塊を精錬します。銅塊と合わせて青銅を作ります。', level: 2, cost: { cutStone: 16, timber: 7, charcoal: 8 } },
  trialBronzeFurnace: { name: '試験青銅炉', description: '文明発展用の試験青銅を生産します。建設できるのは1基だけです。', level: 2, cost: { cutStone: 15, timber: 8, charcoal: 10 }, limit: 1 },
  storehouse3: { name: '青銅倉庫', description: '全資源区分の保管上限を増やし、青銅期の大量生産を支えます。', level: 3, cost: { cutStone: 30, timber: 18, bronzeIngot: 12 }, capacityBonus: { base: 1500, processed: 500, ore: 250, metal: 250 } },
  bronzeWorkshop: { name: '青銅工房', description: '銅塊と錫塊を青銅塊へ加工します。青銅装備や上位施設に使います。', level: 3, cost: { cutStone: 24, timber: 14, bronzeIngot: 10 } },
  bloomery: { name: '塊鉄炉', description: '鉄鉱石と木炭から鉄塊を作ります。鍛鉄生産の前工程です。', level: 3, cost: { cutStone: 30, timber: 12, bronzeIngot: 8, charcoal: 20 } },
  forge: { name: '鍛冶場', description: '鉄塊を鍛鉄へ加工します。鉄器施設と上位防衛設備に使います。', level: 3, cost: { cutStone: 26, timber: 16, bronzeIngot: 10, charcoal: 15 } },
  storehouse4: { name: '鉄器倉庫', description: '全資源区分の保管上限を増やし、鉄器都市の備蓄を支えます。', level: 4, cost: { cutStone: 45, timber: 24, wroughtIron: 16 }, capacityBonus: { base: 3000, processed: 1000, ore: 500, metal: 500 } },
  steelStorehouse: { name: '鋼鉄倉庫', description: '鋼材を含む金属資源と大規模防衛用資材の保管上限を増やします。', level: 5, cost: { cutStone: 60, timber: 30, wroughtIron: 24, steel: 8 }, capacityBonus: { base: 3000, processed: 1200, ore: 500, metal: 1000 } },
  steelworks: { name: '製鋼炉', description: '鍛鉄と木炭から鋼材を製造します。鋼鉄防衛設備と工兵部隊に必要です。', level: 5, cost: { cutStone: 55, timber: 26, wroughtIron: 28, charcoal: 40 } },
  mechanismStorehouse: { name: '機械倉庫', description: '鋼材と機構部品を中心に、機械都市の高度資材を保管します。', level: 6, cost: { cutStone: 80, timber: 36, steel: 24, mechanism: 6 }, capacityBonus: { base: 4000, processed: 1800, ore: 700, metal: 1400 } },
  mechanismWorkshop: { name: '機構工房', description: '鋼材・加工木材・縄から機構部品を製造します。機械防衛設備と砲撃部隊に必要です。', level: 6, cost: { cutStone: 75, timber: 40, steel: 32, rope: 20 } },
  federalStorehouse: { name: '連邦倉庫', description: '全資源区分の保管上限を大幅に増やし、無制限の拠点拡張を支えます。', level: 7, cost: { cutStone: 110, timber: 55, steel: 36, mechanism: 18 }, capacityBonus: { base: 6000, processed: 2500, ore: 1000, metal: 2000 } },
  integratedWorks: { name: '統合工廠', description: '鋼材と機構部品を高効率で一括生産し、街道連邦全体へ供給します。', level: 7, cost: { cutStone: 100, timber: 50, steel: 40, mechanism: 24 } }
});

export const DEFENSE_LINES = Object.freeze({
  barrier: [
    { key: 'barrier0', name: '丸太柵', hp: 220, cost: { wood: 32, fiber: 10 }, repair: { wood: 20, fiber: 8 } },
    { key: 'barrier1', name: '木柵', hp: 340, upgrade: { timber: 4, rope: 2 }, repair: { timber: 2, rope: 1 } },
    { key: 'barrier2', name: '石壁', hp: 560, upgrade: { cutStone: 12, timber: 2 }, repair: { cutStone: 3 } },
    { key: 'barrier3', name: '青銅補強壁', hp: 760, upgrade: { cutStone: 14, bronzeIngot: 4 }, repair: { cutStone: 3, bronzeIngot: 1 } },
    { key: 'barrier4', name: '鉄壁', hp: 1050, upgrade: { cutStone: 20, wroughtIron: 6 }, repair: { cutStone: 4, wroughtIron: 1 } },
    { key: 'barrier5', name: '鋼鉄補強壁', hp: 1450, upgrade: { cutStone: 28, steel: 8 }, repair: { cutStone: 5, steel: 1 } },
    { key: 'barrier6', name: '機構防壁', hp: 1900, upgrade: { cutStone: 36, steel: 10, mechanism: 4 }, repair: { cutStone: 6, steel: 2 } },
    { key: 'barrier7', name: '城塞防壁', hp: 2450, upgrade: { cutStone: 48, steel: 14, mechanism: 8 }, repair: { cutStone: 8, steel: 2, mechanism: 1 } }
  ],
  single: [
    { key: 'single0', name: '投石台', type: 'gun', hp: 150, range: 78, damage: 5, cooldown: 2.2, cost: { wood: 28, stone: 22, fiber: 8 } },
    { key: 'single1', name: '強化投石台', hp: 180, range: 85, damage: 7, cooldown: 2, upgrade: { timber: 5, rope: 2, stone: 12 } },
    { key: 'single2', name: '石造投石塔', hp: 225, range: 92, damage: 10, cooldown: 1.9, upgrade: { cutStone: 8, timber: 5, rope: 2 } },
    { key: 'single3', name: '青銅投槍台', hp: 280, range: 100, damage: 17, cooldown: 1.8, upgrade: { timber: 8, rope: 3, bronzeIngot: 6 } },
    { key: 'single4', name: '鉄弩砲', hp: 350, range: 115, damage: 30, cooldown: 2, upgrade: { timber: 10, rope: 4, wroughtIron: 10 } },
    { key: 'single5', name: '連弩塔', hp: 440, range: 125, damage: 42, cooldown: 1.8, upgrade: { timber: 14, rope: 6, steel: 10 } },
    { key: 'single6', name: '機関弩砲', hp: 550, range: 138, damage: 58, cooldown: 1.65, upgrade: { timber: 18, steel: 12, mechanism: 6 } },
    { key: 'single7', name: '精密連弩砲', hp: 680, range: 150, damage: 78, cooldown: 1.5, upgrade: { timber: 22, steel: 16, mechanism: 10 } }
  ],
  area: [
    { key: 'area0', name: '岩落とし台', type: 'mortar', hp: 150, range: 90, damage: 18, cooldown: 16, blastRadius: 18, maxTargets: 3, splashMultiplier: 0.60, cost: { wood: 50, stone: 60, fiber: 18 } },
    { key: 'area1', name: '大型岩落とし台', hp: 185, range: 100, damage: 24, cooldown: 15, blastRadius: 20, maxTargets: 3, splashMultiplier: 0.60, upgrade: { timber: 4, cutStone: 4 } },
    { key: 'area2', name: '牽引式投石機', hp: 235, range: 115, damage: 34, cooldown: 14, blastRadius: 22, maxTargets: 4, splashMultiplier: 0.60, upgrade: { cutStone: 10, timber: 8, rope: 5 } },
    { key: 'area3', name: '青銅破砕機', hp: 300, range: 132, damage: 48, cooldown: 13, blastRadius: 25, maxTargets: 5, splashMultiplier: 0.65, upgrade: { cutStone: 16, timber: 10, bronzeIngot: 8 } },
    { key: 'area4', name: '重投石機', hp: 380, range: 150, damage: 68, cooldown: 12, blastRadius: 28, maxTargets: 6, splashMultiplier: 0.65, upgrade: { cutStone: 20, timber: 16, rope: 8, wroughtIron: 8 } },
    { key: 'area5', name: '鋼鉄投石機', hp: 480, range: 165, damage: 88, cooldown: 11.5, blastRadius: 31, maxTargets: 7, splashMultiplier: 0.68, upgrade: { cutStone: 26, timber: 18, steel: 10 } },
    { key: 'area6', name: '平衡錘式投石機', hp: 610, range: 180, damage: 112, cooldown: 10.8, blastRadius: 35, maxTargets: 8, splashMultiplier: 0.70, upgrade: { cutStone: 34, steel: 14, mechanism: 7 } },
    { key: 'area7', name: '城塞砲撃台', hp: 760, range: 198, damage: 145, cooldown: 10, blastRadius: 38, maxTargets: 10, splashMultiplier: 0.72, upgrade: { cutStone: 44, steel: 18, mechanism: 12 } }
  ],
  slow: [
    { key: 'slow0', name: '蔓縄罠', type: 'slow', hp: 150, range: 72, slow: 0.25, duration: 6, damage: 1, maxTargets: 3, cooldown: 8, cost: { wood: 14, stone: 8, fiber: 28 } },
    { key: 'slow1', name: '杭と縄の罠', hp: 175, range: 78, slow: 0.30, duration: 7, damage: 1, maxTargets: 3, cooldown: 7.5, upgrade: { timber: 2, rope: 4 } },
    { key: 'slow2', name: '重石罠', hp: 215, range: 86, slow: 0.36, duration: 8, damage: 2, maxTargets: 4, cooldown: 7, upgrade: { cutStone: 5, rope: 4 } },
    { key: 'slow3', name: '青銅拘束具', hp: 260, range: 94, slow: 0.42, duration: 9, damage: 3, maxTargets: 5, cooldown: 6.5, upgrade: { cutStone: 8, rope: 4, bronzeIngot: 5 } },
    { key: 'slow4', name: '鉄杭罠', hp: 320, range: 102, slow: 0.48, duration: 10, damage: 4, maxTargets: 6, cooldown: 6, upgrade: { timber: 4, rope: 3, wroughtIron: 5 } },
    { key: 'slow5', name: '鎖式拘束具', hp: 400, range: 112, slow: 0.52, duration: 10, damage: 5, maxTargets: 7, cooldown: 5.7, upgrade: { rope: 8, steel: 8 } },
    { key: 'slow6', name: '機構拘束装置', hp: 500, range: 122, slow: 0.56, duration: 11, damage: 6, maxTargets: 9, cooldown: 5.3, upgrade: { steel: 10, mechanism: 6 } },
    { key: 'slow7', name: '道路封鎖網', hp: 620, range: 134, slow: 0.60, duration: 12, damage: 8, maxTargets: 10, cooldown: 5, upgrade: { rope: 12, steel: 14, mechanism: 10 } }
  ],
  repair: [
    { key: 'repair0', name: '修繕小屋', type: 'relay', hp: 180, range: 105, repairTower: 5, repairBarrier: 6, cooldown: 3, cost: { wood: 34, stone: 14, fiber: 18 } },
    { key: 'repair1', name: '木工修繕所', hp: 220, range: 110, repairTower: 7, repairBarrier: 8, cooldown: 3, upgrade: { timber: 6, rope: 2 } },
    { key: 'repair2', name: '石工修繕所', hp: 270, range: 115, repairTower: 9, repairBarrier: 10, cooldown: 2.8, upgrade: { cutStone: 8, timber: 6 } },
    { key: 'repair3', name: '青銅修繕所', hp: 330, range: 120, repairTower: 12, repairBarrier: 14, cooldown: 2.7, upgrade: { cutStone: 10, timber: 8, bronzeIngot: 5 } },
    { key: 'repair4', name: '鉄器修繕所', hp: 410, range: 128, repairTower: 16, repairBarrier: 18, cooldown: 2.5, upgrade: { cutStone: 12, timber: 8, wroughtIron: 8 } },
    { key: 'repair5', name: '鋼鉄修繕所', hp: 510, range: 138, repairTower: 21, repairBarrier: 24, cooldown: 2.3, upgrade: { cutStone: 16, timber: 10, steel: 9 } },
    { key: 'repair6', name: '機械修繕所', hp: 630, range: 150, repairTower: 27, repairBarrier: 31, cooldown: 2.1, upgrade: { cutStone: 20, steel: 12, mechanism: 6 } },
    { key: 'repair7', name: '中央整備所', hp: 780, range: 165, repairTower: 35, repairBarrier: 40, cooldown: 1.9, upgrade: { cutStone: 28, steel: 16, mechanism: 10 } }
  ],
  medical: [
    null,
    { key: 'medical1', name: '木造回復所', type: 'medical', hp: 170, range: 90, recoveryRate: 0.004, cost: { timber: 8, rope: 3, cutStone: 4 } },
    { key: 'medical2', name: '石造回復所', hp: 220, range: 115, recoveryRate: 0.006, upgrade: { cutStone: 8, timber: 5, rope: 2 } },
    { key: 'medical3', name: '軍医療養所', hp: 285, range: 140, recoveryRate: 0.008, upgrade: { cutStone: 12, timber: 7, bronzeIngot: 5 } },
    { key: 'medical4', name: '総合回復院', hp: 360, range: 170, recoveryRate: 0.010, upgrade: { cutStone: 16, timber: 10, wroughtIron: 7 } },
    { key: 'medical5', name: '野戦病院', hp: 450, range: 190, recoveryRate: 0.012, upgrade: { cutStone: 20, timber: 12, steel: 8 } },
    { key: 'medical6', name: '軍病院', hp: 560, range: 210, recoveryRate: 0.014, upgrade: { cutStone: 24, steel: 10, mechanism: 5 } },
    { key: 'medical7', name: '中央医療院', hp: 690, range: 235, recoveryRate: 0.016, upgrade: { cutStone: 32, steel: 14, mechanism: 9 } }
  ],
  fieldBarracks: [
    null,
    { key: 'fieldBarracks1', name: '前線兵舎', type: 'fieldBarracks', hp: 150, squadCapacityBonus: 1, cost: { timber: 4, rope: 2, fiber: 20 } },
    { key: 'fieldBarracks2', name: '石造前線兵舎', hp: 200, squadCapacityBonus: 1, upgrade: { cutStone: 8, timber: 5, rope: 2 } },
    { key: 'fieldBarracks3', name: '青銅前線兵舎', hp: 260, squadCapacityBonus: 2, upgrade: { cutStone: 10, timber: 7, bronzeIngot: 5 } },
    { key: 'fieldBarracks4', name: '鉄器前線兵舎', hp: 330, squadCapacityBonus: 2, upgrade: { cutStone: 14, timber: 8, wroughtIron: 7 } },
    { key: 'fieldBarracks5', name: '鋼鉄前線兵舎', hp: 420, squadCapacityBonus: 3, upgrade: { cutStone: 18, timber: 10, steel: 8 } },
    { key: 'fieldBarracks6', name: '機械化前線兵舎', hp: 530, squadCapacityBonus: 3, upgrade: { cutStone: 22, steel: 10, mechanism: 5 } },
    { key: 'fieldBarracks7', name: '前線司令所', hp: 660, squadCapacityBonus: 4, upgrade: { cutStone: 30, steel: 14, mechanism: 9 } }
  ],
  survey: [
    null,
    { key: 'survey1', name: '木製測量塔', type: 'survey', hp: 160, surveyRadius: 600, scanInterval: 180, cost: { timber: 6, rope: 3, stone: 20 } },
    { key: 'survey2', name: '石造測量塔', hp: 210, surveyRadius: 900, scanInterval: 150, upgrade: { cutStone: 8, timber: 4, rope: 2 } },
    { key: 'survey3', name: '青銅測量塔', hp: 270, surveyRadius: 1200, scanInterval: 120, upgrade: { cutStone: 10, timber: 6, bronzeIngot: 5 } },
    { key: 'survey4', name: '鉄製測量塔', hp: 340, surveyRadius: 1600, scanInterval: 90, upgrade: { cutStone: 14, timber: 8, wroughtIron: 7 } },
    { key: 'survey5', name: '鋼鉄測量塔', hp: 430, surveyRadius: 1900, scanInterval: 75, upgrade: { cutStone: 18, timber: 10, steel: 8 } },
    { key: 'survey6', name: '信号測量所', hp: 540, surveyRadius: 2200, scanInterval: 60, upgrade: { cutStone: 22, steel: 10, mechanism: 5 } },
    { key: 'survey7', name: '道路網測量局', hp: 680, surveyRadius: 2500, scanInterval: 45, upgrade: { cutStone: 30, steel: 14, mechanism: 9 } }
  ],
  gate: [
    null, null,
    { key: 'gate2', name: '石門', hp: 700, cost: { cutStone: 18, timber: 8, rope: 4 } },
    { key: 'gate3', name: '青銅門', hp: 950, upgrade: { cutStone: 18, timber: 8, bronzeIngot: 8 } },
    { key: 'gate4', name: '鉄門', hp: 1300, upgrade: { cutStone: 24, timber: 8, wroughtIron: 12 } },
    { key: 'gate5', name: '鋼鉄門', hp: 1750, upgrade: { cutStone: 30, steel: 14 } },
    { key: 'gate6', name: '機関門', hp: 2350, upgrade: { cutStone: 40, steel: 18, mechanism: 8 } },
    { key: 'gate7', name: '城塞大門', hp: 3000, upgrade: { cutStone: 52, steel: 24, mechanism: 14 } }
  ]
});

export const ENEMY_DROPS = Object.freeze({
  infantry: { wood: 2, stone: 1 }, scout: { fiber: 3, wood: 1 }, shield: { wood: 2, stone: 3 },
  engineer: { wood: 2, stone: 2, fiber: 1 }, heavy: { stone: 5, wood: 2 }, raider: { wood: 2, fiber: 4 }
});

export function emptyResourceBundle() { return Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0])); }

export function defenseLineForType(type) {
  return type === 'barrier' ? 'barrier' : type === 'gun' ? 'single' : type === 'mortar' ? 'area' : type === 'slow' ? 'slow' : type === 'survey' ? 'survey' : type === 'medical' ? 'medical' : type === 'fieldBarracks' ? 'fieldBarracks' : 'repair';
}

export function defenseTierDefinition(type, tier = 0, isGate = false) {
  const line = isGate ? 'gate' : defenseLineForType(type);
  return DEFENSE_LINES[line]?.[tier] ?? null;
}
