# 春秋战国-车之战

一个以春秋战国为背景、使用原生 HTML、CSS 和 Canvas 的俯视角战车游戏。无需安装依赖；ES modules 需要通过本地 HTTP 服务运行。

## 运行

从项目根目录启动静态服务器：

```sh
node scripts/serve.mjs 8000     # 推荐：只需 Node，ES module 并发加载不会掉连接
python3 -m http.server 8000     # 备选：使用系统自带 Python
```

随后访问 <http://localhost:8000>。`scripts/serve.mjs` 只用 Node 标准库，并为 `.js`、`.css` 等返回正确的内容类型且禁用缓存，改动后刷新即可生效；Python 的 `http.server` 监听队列只有 5，偶尔会在首屏并发加载模块时丢连接导致启动失败，刷新一次即可恢复。

## 游戏流程

主菜单开始新征途 → 驾车完成战场目标（普通战局讨伐指定数量的敌军；第 4、6、8… 战局迎战随机首领并将其击败）→ 驾车前往随机生成并持续指引的撤离区域 → 在凯旋商店整备并手动开始下一战。地图、敌军编队和战利品会在征途中变化；装备、战马和存活车员会保留到下一战。

## 操作

- **W / A / S / D** 或方向键：模拟摇杆，方向代表地图上的移动方向；战车会平滑转向并沿车头前进
- 松开方向键：战车凭惯性减速至停止
- **空格**：发射弩箭，按住的时长决定是哪一种。按住不足 0.6 秒就松开是短射：弩手自动挑出车头前方 ±60° 锥形内、视线畅通、380 px 以内最近的敌人，按这个实际距离解算弹道，因此近身也能落在目标身上，而不是从它头顶飞过去；锥形内没有敌人时照常射出，只是不带辅助瞄准。按住 0.6 秒以上再松开是原有的长程固定弹道，射得比短射更远，用于压制远处目标
- **P / Escape**：暂停或继续
- **触屏**：摇杆方向就是地图移动方向；战车会平滑转向，松开摇杆后凭惯性减速；使用发射键攻击，按下即开始蓄力（外环显示蓄力进度），按住不足 0.6 秒松开是上面说的短射，按住更久再松开是长程固定弹道
- **触屏反向小输入**：静止或慢速时，朝车头后方约 135° 以上轻推摇杆（幅度不超过 0.45），战车会沿车尾方向倒车，并带一点后轮转向：车头以约 42°/s 的慢速转向摇杆的反方向，也就是车尾跟着摇杆摆；斜向倒车因此沿弧线并入摇杆方向（最多摆 45°，约 1.1 秒），推满摇杆仍是原来的转向

每个战局只有一次挑战机会，不再有三辆战车的复活次数。战车耐久耗尽后将下车继续作战：WASD / 方向键直接移动步卒，空格挥剑。驾驶员固定随车，不占车员名额且不攻击；招募的弓手会自动射箭，戟士会自动近战，二者均可在步战中阵亡。阵亡车员不会自动补充，可按相同价格重新招募。车箱等级决定车员名额：初始 1 个，升级后为 3、5、9 个。战马初始 1 匹，最多 4 匹，提供机动加成。步卒阵亡则本役失败；可重试当前战局，保留已购装备和已收军资。

移动设备建议横屏游玩。战斗画面会铺满屏幕，并提供半透明摇杆与攻击键；战车阶段摇杆方向直接决定地图上的移动目标方向，战车平滑转向并沿车头前进，急转时会减速，松开摇杆后凭惯性减速至停止。静止或慢速（低于 32 px/s）时，朝车头后方约 135° 以上轻推摇杆且幅度不超过 0.45，战车会沿车尾方向倒退，同时带轻微的后轮转向：车头以约 42°/s 的慢速转向摇杆的反方向，车尾跟着摇杆摆，斜向倒退因此沿弧线并入摇杆方向（最多约 45°、约 1.1 秒）而不是瞬间横移；角度或幅度超出该范围时仍按原有方式转向。键盘输入固定为满幅，因此只走转向分支。步战阶段摇杆切换为直接移动，攻击键改为按下即挥剑：蓄力只属于车上的弩，下车后不会留下一段悬着的蓄力。摇杆在窗口尺寸变化时保持显示，摇杆内的细环标出的正是反向小输入的半径。所有箭矢和石弹都会飞完全程落地，不会在半空中凭空消失：弓箭落地后会短暂留在地面，石弹无论落在空地、被墙木挡住还是命中目标，都会扬起浅色尘土并留下扩散的冲击环（战场草色偏亮，尘土因此使用更浅的色调，时长也长于普通火花）。玩家和随行车员受伤时也会留下血迹。已招募的弓手和戟士会在下车后跟随玩家并自动攻击；初始驾驶员不攻击，也不作为步战援兵。

战车属性为火力、防护、机动、稳定、容量，初始为 3 点（容量 2 点），范围为 1–10。火力决定弩箭伤害（火力 × 1.5）；防护按属性值 × 5% 概率完全抵消一次针对整辆战车的远程攻击；机动乘数为 0.5 + 机动 × 0.05；稳定决定战车耐久（稳定 × 10，初始 30 点）；容量仅供显示，车员名额由车箱升级决定。五件装备各有三级，后续等级会按配置明确带来属性惩罚；战马只增加机动。凯旋商店显示五项属性与购置预览，装备、马匹和人员价格均由配置表提供。这些换算集中定义在 `src/data/rules.js` 与 `src/data/equipment.js` 的派生函数中。

战车高速正面冲撞可对可冲撞的敌人造成伤害，基础为 1 点；每级轴与轮辋升级额外增加 2 点（Lv1/Lv2/Lv3 分别为 3/5/7 点）。普通接触不造成冲撞伤害，重甲单位等免疫冲撞伤害的敌人仍不会受伤。机动和战马只影响战车速度与转向，不会直接增加冲撞伤害；弩架只提高弩箭伤害。

冲撞步卒或弓手会将其撞倒，片刻后重新起身；重甲步卒可被撞倒，但不会受到车轮冲撞伤害，仍可被武器击伤。高速冲阵会以醒目的金色冲击特效刮伤敌军，并受到密集步卒反击。敌军刀剑与戈的近战攻击有不同的挥击特效，也会伤害车体；步卒会在攻击距离保持稳定，不再贴身前后抖动。战场上有轻薄、缓慢飘移的云影，不会遮挡单位。战马数量由购置决定，最多四匹，战马可见地随战车行进。敌方弓手、投石兵和弓车会在视线畅通时发射带抛物线的箭矢或石弹；墙木会遮挡低空弹道。战场上有浅滩、沙地和草地，分别会显著、中度和轻微减慢所有单位。步卒编队会护住后排远程单位，只在战车未进入阵型范围时保持阵线；战车一旦驶入阵型范围，整条阵线会一起压上来，追出有限的距离后收兵回位，不会无休止地追击，也不会被逐个引走。第 4、6、8… 战局会出现象兵、狮王馭者或投石车首领，首领战仍会持续刷新普通敌军；击败首领后前往撤离点。受伤单位会在地面留下有限数量的血迹。战车遭受弩箭、战车冲撞或高速撞上障碍会损伤车体；耐久耗尽后下车继续作战。敌军会掉落铜钱、银锭或金饼，接触拾取；达成目标后，未拾取的战利也会在凯旋时收归军府。

## 项目结构

```text
h5game/
├── index.html
├── README.md
├── scripts/
│   ├── perf-test.mjs             # Frame-budget benchmark for the per-frame loops
│   ├── smoke-test.mjs            # Boots main.js against a stub DOM and runs battle frames
│   └── unit-test.mjs             # Rules, collision, ballistics, bow aim assist, blood and RNG checks
├── styles/
│   └── game.css
├── src/
│   ├── main.js                   # Browser entry point
│   ├── i18n/
│   │   ├── index.js              # Locale selection, translation and DOM updates
│   │   └── locales.js            # Simplified Chinese and English messages
│   ├── utils/
│   │   ├── math.js               # Shared clamp and distance helpers
│   │   └── random.js             # Seeded PRNG for reproducible battles
│   ├── data/
│   │   ├── battlefields.js       # Battlefield names, ground labels and per-map element mixes
│   │   ├── elements.js           # Map element catalog: one row per obstacle, terrain and cloud kind
│   │   ├── equipment.js          # Equipment, horse and personnel values; derived stat helpers
│   │   ├── formations.js         # Formation patterns and unit/boss stats
│   │   └── rules.js              # Balance constants for stats, projectiles, impact effects and campaign pacing
│   ├── game/
│   │   ├── game.js               # Composition root: wires systems and owns the frame loop
│   │   ├── loop.js               # requestAnimationFrame loop with failure isolation
│   │   ├── state.js              # Player, campaign, and battle state creation
│   │   ├── map.js                # Procedural battlefield scatter, driven by the element catalog
│   │   ├── stages.js             # Campaign stages, objectives, extraction, progression
│   │   ├── collision.js          # Obstacle/terrain collision, movement clamping, indexed line of sight
│   │   ├── elements.js           # Element runtime: shapes, sight, movement cost, drift, footprint queries
│   │   ├── combat.js             # Player fire (tap/drawn bow), crew attacks, damage, dismounting
│   │   ├── aim.js                # Tap-shot target picker: nearest enemy in the nose's cone with a clear line
│   │   ├── player.js             # Steering and player movement
│   │   ├── projectiles.js        # Ballistic projectile creation, arcs, and collision
│   │   ├── particles.js          # Particle lifecycle: the one builder, integrator and pruner
│   │   ├── trails.js             # Speed-scaled ground dust behind anything travelling
│   │   ├── blood.js              # Blood decal accumulation
│   │   ├── equipment.js          # Shop purchases and campaign roster
│   │   └── units/
│   │       ├── enemies.js        # Enemy/boss spawning, damage, and collision
│   │       ├── behaviours.js     # One brain per unit type: sight response, guard post, chase
│   │       └── formations.js     # Formation geometry: slot leash, alert footprint, chase envelope
│   ├── render/
│   │   ├── camera.js             # Player-follow camera (clamped delta, self-healing)
│   │   ├── elements.js           # Element art: palisades, canopies, terrain patterns, cloud puffs
│   │   ├── sprites.js            # Unit art: chariot rig and foot figure, shared by battlefield and shop
│   │   └── renderer.js           # Canvas rendering for terrain, units, and effects
│   ├── platform/
│   │   └── launch.js             # Host seam: `launchQuery()` reads `?seed=` (小游戏 reads wx launch options)
│   ├── assets/
│   │   └── audio.js              # Centralized sound playback
│   └── ui/
│       ├── elements.js           # DOM element registry
│       ├── controls.js           # Keyboard, touch, and screen event bindings
│       ├── hud.js                # Battle HUD updates
│       ├── screens.js            # Menu, pause, and defeat screen state
│       ├── shop.js               # Shop ledger: tabs, item cards, hover previews
│       ├── shop-info.js          # The one description panel: standing rule, hovered or picked item
│       ├── radar.js              # Five-axis stat chart (SVG), current vs preview
│       ├── shop-scene.js         # Canvas previews: the chariot rig and the camp fire
│       └── shop-layout.js        # Pure geometry: radar axes, rig fit, camp seats
└── assets/                       # Reserved for imported art, music, and sound effects
```

界面支持简体中文和英文，默认使用简体中文。文案集中在 `src/i18n/locales.js`，`src/i18n/index.js` 负责翻译、插值、静态 DOM 更新及语言偏好保存；语言切换不会重置战局。新增或修改界面文案时，需同时补齐两种语言，并使用稳定的翻译 key，避免在游戏规则或绘制逻辑中散落展示文字。公共纯逻辑仅在确有复用时抽取到职责明确的 `src/utils/` 模块。

本项目没有构建步骤或 package manifest，语法检查与测试都直接交给 Node：

```sh
find src scripts \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check   # 语法检查
node scripts/unit-test.mjs                       # 规则、碰撞、弹道、血迹、相机、随机数与商店雷达/营地几何/信息栏
node scripts/smoke-test.mjs                      # 用 stub DOM 启动 main.js 并跑战斗帧
node scripts/perf-test.mjs                       # 逐帧性能预算：敌军 AI、随从齐射、下车随从、弹道
H5_SEED=7 node scripts/smoke-test.mjs            # 换一个随机种子复跑同一套冒烟检查
```

`H5_SEED` 只用于探索性复跑：冒烟脚本用固定输入脚本驱动固定帧数，个别种子在这个窗口里还没打中目标，于是 `score advanced past zero` 会变红（改动前的 `main` 上同样如此，与本次时间基准修复无关）。CI 固定使用默认种子 1。

`scripts/smoke-test.mjs` 以最小 DOM 桩启动真实的 `src/main.js`，跑数百帧并模拟移动与射击，用于在无浏览器环境下发现启动期与逐帧异常；它会固定 `?seed=1` 让每次运行逐帧一致，并通过 `window.__h5game` 校验敌军生成、坐标有限性与战局时间，而不只依赖 HUD 文本；弩的两段手感也在这里跑：按住 0.75 秒松开必须走长程冷却、6 帧轻点必须走短射冷却，且锥形内没有敌人时依旧放箭，同时校验按钮的 `--charge` 与 `.charged` 随按住/松手切换。canvas 桩会把任何非有限数字的绘制调用记录为失败，因此在没有浏览器的环境里也能发现 `NaN` 变换。它不能替代真实浏览器验收，最终仍需按上文通过 HTTP 服务运行游戏确认画面与手感。`.github/workflows/checks.yml` 在每次推送与合并请求时执行其中三条命令（语法检查、单元测试、冒烟测试）；`perf-test.mjs` 是本地预算闸门，不放进 CI，因为共享 runner 的耗时波动会让阈值误报。

冒烟脚本最后还有一段“下车阶段”：先通过真实的“下一战”流程重开一场战局，买入一名弓手和一名长戈兵，再用真实的伤害路径把车体打空，于是 `dismountPlayer`、随从站位、随从寻敌与齐射都会真正跑起来。这段流程需要 HUD 之外的两个入口，因此 `window.__h5game` 额外暴露了 `combat` 与 `stageManager`（仍然只由测试脚本读取）。

`scripts/perf-test.mjs` 用同一套种子化的战场（46 个障碍、四支编队、满编随从）给每帧循环计时，并把阈值写在文件顶部的 `budgets` 里：敌军 AI、弓手齐射、下车随从、30 发弹道，以及单次 `hasLineOfSight` 的微秒成本。阈值是棘轮 —— 每一项都紧贴当前实测值，性能改动落地后要把它调低，注释里记着实测数与目标数。

商店页也有一条冒烟链路：脚本用 `stageManager.enterShop()` 真正切进商店，断言属性雷达、战车预览与营地篝火都画出了帧，再走一遍“悬停预览 → 重新渲染”确认预览不会残留到下一帧（存活的预览会画出玩家并未拥有的车队）。商品卡本身只留标题、效果行与价格，长说明统一交给信息栏：开页时显示冲撞伤害规则，悬停或聚焦某张卡就换成该卡的说明，点击则把这条说明钉住（购置会整页重渲染，钉住的说明必须还在），切类别回到规则——冒烟测试逐条走完这条链路，单元测试则直接对 `createInfoPanel()` 断言规则态、条目态与“没有子节点时整行落在 `textContent`”。雷达的坐标、战车缩放与篝火座位是纯几何，另有单元测试直接守住：`radarPolygon()` 必须等于 `calculateChariotStats()` 的五个属性值，任何装备加成或惩罚的 stat 名都必须出现在雷达轴表里，四个马匹数量的战车都必须完整落在画布内。场景自己的时钟也有测试：商店关闭时既排不出动画帧也不出笔，打开后队列里始终只有一个 rAF，悬停则按当前相位立刻重绘；隐藏的篝火画布（量为 0×0）和根本没有画布的页面都必须是空操作。

视线查询曾经是最大的逐帧热点：每次 `hasLineOfSight` 沿线段每 12px 采样一次，每个采样点都要遍历全部约 46 个障碍（约 1.5k 次形状测试），而一名准备就绪的弓手会为每个候选敌人各走一遍。现在 `collision.js` 在开战换列表时把“遮挡视线的”元素按格装进一张均匀网格索引（`campaign.obstacles` 换了列表或长度才重建），每个采样点只查自己所在的格子，判定结果与全表遍历逐条等价（单元测试用 500 条随机线段对拍）；`combat.js` 则把随从的冷却检查移到寻敌之前，装填中的弓手不再白算一遍视线。同一套基准下，单次视线从约 57µs 降到 0.6µs，弓手齐射从约 12ms 的突发降到 0.2ms，下车随从从约 9ms 降到 0.15ms，敌军 AI 从约 0.9ms 降到 0.25ms，而 `H5_TRACE=1` 的逐帧摘要完全不变 —— 这是一次只改代价、不改行为的重构。小游戏端同源同款，摘要同样不变。

两次同种子的运行必须打印同样的摘要：`H5_TRACE=1` 把每帧模拟数值折叠成一个哈希，`H5_TRACE_DRAW=1` 折叠每一次 canvas 调用（并统计调用次数），`H5_TRACE_LOG=<path>` 写出逐帧数值以便定位第一个分歧帧。重构渲染或地图生成时，用它们区分“有意改变”与“顺手改坏”：只搬代码的改动应当摘要不变，换了生成规则（例如按战场分配地表成分）则应当只变一次，并在提交说明里记下新的基线。摘要覆盖随从快照（血量、伤害、射程、冷却）、名册冷却和下车阶段，因此随从重构无法在“哈希不变”的情况下偷换数值。小游戏端 `scripts/headless-smoke.mjs` 用同一套字段、同一组 `H5_TRACE*` 变量输出摘要，两端可以互相对照。

时间基准只有一个写入者：`src/game/loop.js` 用帧回调自身的时间戳维护 `state.lastTime`，并把每帧增量限制在 `[0, 0.05]` 秒、非有限值按 0 处理。其它模块（包括 `stages.js` 的开战流程）只读不写 `state.lastTime` —— 过去用 `performance.now()` 打时间戳会让首帧增量变成约 -1.8e9 秒，把相机推到 `-Infinity` 再变成 `NaN`（`inView()` 全部为假，小游戏 iPhone X 上直接内存溢出）。`src/render/camera.js` 也独立兜底：增量同样限幅，且一旦发现自己非有限就重新贴回目标位置。冒烟测试在开战/恢复点击后立即断言这条契约（晚一帧就会被循环覆盖），所以这两处回归都会立刻变红。

在任意地址后加 `?seed=<数字>`（例如 `http://localhost:8000/?seed=7`）即可固定本局种子，战场、编队与掉落都会重演，便于复盘问题。启动参数由 `src/platform/launch.js` 的 `launchQuery()` 读取，`game.js` 只把 `seedSource` 注入 `createGameState()` 与 `createStageManager()`，`src/utils/random.js` 保持纯函数（`parseSeed()` / `createRandomSeed()`），因此引擎层不依赖 `location`、`URLSearchParams` 或 `wx`。`window.__h5game` 暴露 `state`、`player`、`campaign`、`world`、`view`、`camera`，仅供调试脚本读取。

Gameplay behavior is coordinated by `game/game.js`; specialized systems receive shared state and callbacks through small factories. `game/collision.js` owns obstacle/terrain queries, `game/combat.js` owns player fire and damage, `game/projectiles.js` owns ballistic flight and impacts, and `game/loop.js` owns the animation-frame loop with failure isolation. The loop is also the only writer of the time base (`state.lastTime`), clamping every delta to `[0, 0.05]` seconds and treating non-finite values as zero; `render/camera.js` re-seats itself if it is ever handed a non-finite position, so no single bad frame can poison the view for the rest of the session. Collision lives in one factory so player, enemy, and projectile code share the same geometry rules.

Particles have one lifecycle module, `game/particles.js`: `spawnParticle()` fills the fields every emitter used to repeat, `updateParticles()` and `pruneParticles()` advance and drop them, and `countParticles()` answers "how many of this kind are alive". The impact burst in `units/enemies.js`, the speed-scaled ground trail in `game/trails.js` and the frame loop in `game.js` all go through it, so a field that a copy used to forget - `maxLife`, say, which the renderer needs to compute alpha - cannot diverge between emitters. The trail itself measures speed from each unit's own displacement (`distance / delta`) instead of its `speed` field, which makes a hull pinned against a wall, a unit turning on the spot and a crowd being shoved stay quiet for free; a displacement pointing away from the nose is rejected, so a reversing chariot (and the drag of a knockback) leaves no wake. It draws no random numbers at all - a lateral offset and a palette step alternate instead - because every draw would come out of the battle's seed stream and move every enemy decision in the run. The cap (`effectRules.trail.maxLive`) and the off-screen cull keep a full formation from flooding the list, and the renderer paints the trail in its own pass under the bodies while the sparks, rings and motes keep their pass above them.

Map elements follow the same shape as units, one layer down: `data/elements.js` holds one row per kind (shape, whether it blocks movement and sight, its size ranges and its palette), `game/elements.js` is the runtime half that answers questions about an instance, and `render/elements.js` owns the silhouettes. Instances stay plain data - `{ type, x, y, radius }` for circles, `{ type, x, y, width, height }` for axis-aligned walls - and are resolved by `type` at query time, so a new kind is a row plus, only if the silhouette is genuinely new, one draw function. Rows are deep-frozen, and an instance whose type matches no row falls back on its own fields, which is what keeps hand-built test fixtures and older saves working.

Unit silhouettes are shared the same way but in the other direction: `render/sprites.js` paints a chariot rig or a foot figure in unit-local space, and every caller owns the transform, the ground shadow and the health bar. The battlefield renderer and the shop's preview rig both call the same painter, so a new horse pose or banner appears in both places in one commit, and the unit test measures the rig's real draw calls against `chariotRigBox()` - the box the shop scales into - so a larger silhouette cannot silently start clipping in the preview. The other half of that guard is a source-level test: `renderer.js` may not paint unit art itself. Team colours come from `spritePalette` in the same module, so a preview cannot show the player in a green the battlefield never uses.

The shop dossier is the same rule applied to the camp: `ui/shop-layout.js` holds the pure geometry (the radar's five axes and axis labels, the rotated extent the rig is fitted into, the seats around the fire), `ui/radar.js` turns the shared stat table into one SVG whose dashed ring shows the hovered purchase, and `ui/shop-scene.js` draws the rig and the camp fire on its own clock. The scene takes a snapshot of the team exactly once per render (`update()`) and drops any hover preview with it, so a card the player is only pointing at can never survive into the next frame; it only runs its animation frame while the shop screen is up (`setActive` from `screens.js`). Only the living take a place on the hull or at the fire: the roster keeps its dead for the ledger, and `target()` filters them out for both canvases. Stat deltas are read out of the same `data/equipment.js` rows the purchase uses, which is why the chart, the card text and the price can never disagree.

Descriptions are the one thing the shop does not repeat per card. `ui/shop-info.js` owns a single panel under the summary: it shows the collision rule while nothing is picked, the hovered or focused card's own copy while the pointer is on a card, and keeps the last clicked item's copy after the pointer leaves - which is what makes a purchase readable, because `ui/shop.js` records the pick before it runs the purchase and the re-render paints that remembered id. Switching tabs drops the pick, so the panel never explains a card that is no longer on screen. Cards keep only a title, the effect line the purchase changes and the price, and the panel is a live region whose label/body pair is looked up once and re-painted on every locale change, so no description is ever pasted twice.

Each battlefield narrows the catalog with a `mix`: obstacle entries are shares of the same 46-obstacle target, terrain entries replace the default patch counts, and a kind a mix leaves out never spawns there - that is the whole difference between a flooded crossing and a fortified pass. The obstacle budget is a target rather than a count of tries, because a tree that would touch another tree is dropped: a tree-heavy marsh therefore lands the same number of obstacles as a wall-heavy pass instead of thinning out. Formations spawn through a ground ladder - dry, then uniform, then merely clear, then the old slot-centre rule - and the rung that placed a line is recorded as `groundTier`. The test is `rectHitsObstacle` against the rank box (`formationGroundExtent`), not against slot centres, so a 28px palisade standing between two ranks now rejects the ground; the last rung is pinned at zero spawns.

Random draws that affect gameplay go through `campaign.random`, a Mulberry32 stream seeded per battle by `src/utils/random.js`, so a battle can be replayed deterministically. Purely cosmetic jitter may still use `Math.random()`. The renderer skips terrain, decals, units, projectiles, and effects outside the camera view. Canvas-drawn art and synthesized tones remain the active rendering/audio paths.
