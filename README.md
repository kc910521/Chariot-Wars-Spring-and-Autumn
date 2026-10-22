# 春秋战国-车之战

一个以春秋战国为背景、使用原生 HTML、CSS 和 Canvas 的俯视角战车游戏。无需安装依赖；ES modules 需要通过本地 HTTP 服务运行。

## 运行

从项目根目录启动静态服务器：

```sh
python3 -m http.server 8000
```

随后访问 <http://localhost:8000>。

## 游戏流程

主菜单开始新征途 → 驾车完成战场目标（普通战局讨伐指定数量的敌军；每四战局迎战随机首领并将其击败）→ 驾车前往随机生成并持续指引的撤离区域 → 在凯旋商店整备并手动开始下一战。地图、敌军编队和战利品会在征途中变化；装备、战马和存活车员会保留到下一战。

## 操作

- **W / A / S / D** 或方向键：模拟摇杆，方向代表地图上的移动方向；战车会平滑转向并沿车头前进
- 松开方向键：战车凭惯性减速至停止
- **空格**：发射弩箭
- **P / Escape**：暂停或继续
- **触屏**：摇杆方向就是地图移动方向；战车会平滑转向，松开摇杆后凭惯性减速；使用发射键攻击

每个战局只有一次挑战机会，不再有三辆战车的复活次数。战车耐久耗尽后将下车继续作战：WASD / 方向键直接移动步卒，空格挥剑。驾驶员固定随车，不占车员名额且不攻击；招募的弓手会自动射箭，戟士会自动近战，二者均可在步战中阵亡。阵亡车员不会自动补充，可按相同价格重新招募。车箱等级决定车员名额：初始 1 个，升级后为 3、5、9 个。战马初始 1 匹，最多 4 匹，提供机动加成。步卒阵亡则本役失败；可重试当前战局，保留已购装备和已收军资。

移动设备建议横屏游玩。战斗画面会铺满屏幕，并提供半透明摇杆与攻击键；战车阶段摇杆方向直接决定地图上的移动目标方向，战车平滑转向并沿车头前进，急转时会减速，松开摇杆后凭惯性减速至停止。步战阶段摇杆切换为直接移动，攻击键用于弩射或近战。摇杆在窗口尺寸变化时保持显示。弓箭落地后会短暂留在地面，石弹保留原有的落地冲击特效；玩家和随行车员受伤时也会留下血迹。已招募的弓手和戟士会在下车后跟随玩家并自动攻击；初始驾驶员不攻击，也不作为步战援兵。

战车属性为火力、防护、机动、稳定、容量，初始均为 4，范围为 1–10。火力决定弩箭伤害（火力 × 5）；防护按属性值 × 5% 概率完全抵消一次针对整辆战车的远程攻击；机动乘数为 0.5 + 机动 × 0.05；稳定决定战车耐久（稳定 × 10）；容量仅供显示。五件装备各有三级，后续等级会按配置明确带来属性惩罚；战马只增加机动。凯旋商店显示五项属性与购置预览，装备、马匹和人员价格均由配置表提供。

战车高速正面冲撞可对可冲撞的敌人造成伤害，基础为 1 点；每级轴与轮辋升级额外增加 2 点（Lv1/Lv2/Lv3 分别为 3/5/7 点）。普通接触不造成冲撞伤害，重甲单位等免疫冲撞伤害的敌人仍不会受伤。机动和战马只影响战车速度与转向，不会直接增加冲撞伤害；弩架只提高弩箭伤害。

冲撞步卒或弓手会将其撞倒，片刻后重新起身；重甲步卒可被撞倒，但不会受到车轮冲撞伤害，仍可被武器击伤。高速冲阵会以醒目的金色冲击特效刮伤敌军，并受到密集步卒反击。敌军刀剑与戈的近战攻击有不同的挥击特效，也会伤害车体；步卒会在攻击距离保持稳定，不再贴身前后抖动。战场上有轻薄、缓慢飘移的云影，不会遮挡单位。战马数量由购置决定，最多四匹，战马可见地随战车行进。敌方弓手、投石兵和弓车会在视线畅通时发射带抛物线的箭矢或石弹；墙木会遮挡低空弹道。战场上有浅滩、沙地和草地，分别会显著、中度和轻微减慢所有单位。步卒编队会护住后排远程单位，优先保持阵线而非无休止地追击。每四战局会出现象兵、狮王馭者或投石车首领，首领战仍会持续刷新普通敌军；击败首领后前往撤离点。受伤单位会在地面留下有限数量的血迹。战车遭受弩箭、战车冲撞或高速撞上障碍会损伤车体；耐久耗尽后下车继续作战。敌军会掉落铜钱、银锭或金饼，接触拾取；达成目标后，未拾取的战利也会在凯旋时收归军府。

## 项目结构

```text
h5game/
├── index.html
├── README.md
├── styles/
│   └── game.css
├── src/
│   ├── main.js                   # Browser entry point
│   ├── i18n/
│   │   ├── index.js              # Locale selection, translation and DOM updates
│   │   └── locales.js            # Simplified Chinese and English messages
│   ├── utils/
│   │   └── math.js               # Shared clamp and distance helpers
│   ├── data/
│   │   ├── battlefields.js       # Battlefield names and terrain
│   │   ├── equipment.js          # Equipment, horse and personnel values; stat rules
│   │   └── formations.js         # Formation patterns and unit/boss stats
│   ├── game/
│   │   ├── game.js               # Game state, simulation loop, and composition
│   │   ├── state.js              # Player, campaign, and battle state creation
│   │   ├── map.js                # Procedural battlefield generation
│   │   ├── stages.js             # Campaign stages, objectives, extraction, progression
│   │   ├── player.js             # Steering and player movement
│   │   ├── projectiles.js        # Ballistic projectile creation, arcs, and collision
│   │   ├── equipment.js          # Shop purchases and campaign roster
│   │   └── units/
│   │       └── enemies.js        # Enemy/boss spawning, damage, and collision
│   ├── render/
│   │   ├── camera.js             # Player-follow camera
│   │   └── renderer.js           # Canvas rendering for terrain, units, and effects
│   ├── assets/
│   │   └── audio.js              # Centralized sound playback
│   └── ui/
│       ├── elements.js           # DOM element registry
│       ├── controls.js           # Keyboard, touch, and screen event bindings
│       ├── hud.js                # Battle HUD updates
│       ├── screens.js            # Menu, pause, and defeat screen state
│       └── shop.js               # Equipment card rendering
└── assets/                       # Reserved for imported art, music, and sound effects
```

界面支持简体中文和英文，默认使用简体中文。文案集中在 `src/i18n/locales.js`，`src/i18n/index.js` 负责翻译、插值、静态 DOM 更新及语言偏好保存；语言切换不会重置战局。新增或修改界面文案时，需同时补齐两种语言，并使用稳定的翻译 key，避免在游戏规则或绘制逻辑中散落展示文字。公共纯逻辑仅在确有复用时抽取到职责明确的 `src/utils/` 模块。

本项目没有构建步骤或 package manifest。可用 `find src -name '*.js' -exec node --check {} \;` 检查全部 JavaScript 模块，然后按上文通过 HTTP 服务运行游戏。

Gameplay behavior is coordinated by `game/game.js`; specialized systems receive shared state and callbacks through small factories. Canvas-drawn art and synthesized tones remain the active rendering/audio paths.
