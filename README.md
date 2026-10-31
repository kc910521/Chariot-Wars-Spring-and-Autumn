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

主菜单开始新征途 → 序章抽出本局的中文姓名（氏 + 名）并讲述这个名字的由来，同时告知本局将在哪一战结束 → 序章卡片上可选「猛虎下山 · 教学」先用一场三段式演练熟悉驾车、弩射与车阵（详见下一节），也可以直接「出征」→ 驾车完成战场目标（普通战局讨伐指定数量的敌军；第 4、6、8… 战局迎战随机首领并将其击败）→ 驾车前往随机生成并持续指引的撤离区域 → 在凯旋商店整备并手动开始下一战。每一局都在第 10–13 战局中的某一战迎来终局：八名首领结阵而来，击败全部首领并撤离后进入凯旋卡，随后回营休整一段时间才能再次出征。地图、敌军编队和战利品会在征途中变化；装备、战马和存活车员会保留到下一战。

新征途开局时会按权重抽一次姓名：氏名取自 `src/assets/clan/clan_names.json`（如趙、魏、屈、東郭，权重 10 到 2），名取自 `src/assets/clan/given_names.json`（如黑、虎、無忌、盜跖，权重 3 到 1），两者直接相接成「趙黑」这样的姓名。抽中的两行各带一个 `namingStory.reason` 键，序章用它讲「氏从哪来」和「名为何取」，因此新增一个名字只需在表里加一行并补齐两种语言的说明。姓名是数据而不是文案：无论界面语言是哪一种，姓名始终是这两个汉字，只有它周围的句子会翻译。姓名存放在 `campaign.identity` 上，只在开始新征途时重新抽取；重试战局、进入商店、打下一战或切换语言都会沿用同一个名字，战场目标标签也会一直显示「趙黑的目标」。`?seed=` 同时固定这一次抽签，便于复盘。

## 猛虎下山（教学战）

序章卡片上有两个入口：右侧「出征」进入正式征途，左侧「猛虎下山 · 教学」进入一场三段式的教学战。教学战就是这一局的第一战局，只是以剧本方式演出：`state.battleMode` 为 `"tutorial"`，`campaign.stage` 始终为 1，`state.spawnTimer` 设为 `Infinity`（不刷新普通波次），`state.battleMode` 与 `state.tutorial` 都存放在 `state` 上，因此 `stages.createBattle()` 对这一战只需要换一份开局参数，其余（地图、撤离点、商店）都是同一条代码路径。打完开店整备，商店的「开始下一战」会直接进入正式的第 1 战局：`campaign.tutorialHandoff` 在 `rollForNextBattle()` 里被消费一次，战局号因此不 +1。

剧本写在 `src/game/tutorial.js`，只有状态机与三次推镜：**brief**（卡片：摇杆怎么开车、右下角怎么放弩）→ **hunt**（猛虎在场，引导箭头指向它）→ 猛虎倒下后 **pan**（乱军先锋在视野外列阵，镜头推过去）→ **tactics**（卡片，三条各说一件事：步卒守阵位、四五人围住车身会一起反击；弓手在远处朝拉车的马放箭、贴上去就边退边射；敌车先撞上来、血少时回阵中旗鼓下回血再冲）→ **return**（镜头回到战车）→ **engage**（击破乱军先锋，引导箭头始终跟着剩下的人）→ 最后一人倒下后 **muster**（卡片：族中援兵，族里借你八人打完这一仗）→ **orders**（引导箭头指向这支新阵，走进阵中按一次「出击」、再按一次「结阵」）→ **settle**（阵旗一拍，散兵归位，血条回一格）→ **arrive**（乱军精锐在 900px 外列阵，镜头推过去）→ **squadEngage**（带兵击破最后一阵）。

两支敌军都是 `formationPresets` 里的剧本阵型（不入 `formationPatterns` 的轮转池，正式战局永远掷不到它们）：乱军先锋 7 人（4 名枪兵、阵心 1 辆敌车、2 名弓手），乱军精锐 14 人（7 名戈兵 + 2 名重甲 + 1 辆敌车 + 4 名弓手）。族中援兵（`formationPresets.tutorialSquad`，8 人：5 名戈兵、1 名重甲、2 名弓手）是**借来的**，不是买来的：`allies.spawnScenarioLine()` 按教程自己选好的地面直接铺开，`formation.tier` 写 `-1`，`campaign.friendlyFormations` 一个字节都不动，所以练完一局不会白得一支步阵；`despawnScenarioLine()` 在剧本结束那一帧把 8 个人连同阵型一起撤走，商店、下一战和营伍里都看不到他们。它的阵型名沿用募兵第一级（`formation.friendly`）：本来就是同一种阵，玩家在商店里应该认得出。

两次命令由按钮本身回报（`game.js` 的 `onFormationOrder` → `tutorial.noteOrder()`），不从阵型状态反推：按钮是开关，玩家可能在一帧之内按完两次，而「安静下来是 hold」分不出「按过两次」和「一次都没按」。演练里的顺序是固定的：`结阵` 在 `出击` 之前不算数，HUD 的计数器（`tutorial.orderLabel`，0/2 → 1/2 → 2/2）按真实按下的那一次走。

阵圈随命令换一种画法（`renderer.js` 的 `drawFormation`）：圈里那层淡淡的铺色代表「这条线占住的地」，也正是阵旗回血的那块地 —— `tickFormationAura` 对行进的队伍本来就跳过不给回血。所以 `出击` 之后圈挂在车上、随玩家一起走时只剩虚线轮廓，车底下不再铺绿；`结阵` 把圈落回地面那一帧铺色随即恢复，还没归位的士卒则由琥珀色描边说明。

文案只讲触屏：左手摇杆、右下角「弩 / 击」与「出击 / 结阵」、卡片自己的按钮，一个键名都不出现（单元测试对 `tutorial.*` 逐条禁止 `空格 / Space / WASD / Enter / 方向键`）。卡片就是战场那张唯一的卡（`ui/battle-card.js`）：教程只交出「哪张卡」，标题与正文的 locale key 由 `cardForTutorial()` 拼成一条 spec，DOM 负责换行、滚动与命中——画布版本为了这三件事自己量过一遍字符串、自己算过按钮矩形，现在这些几何都不存在了。正文条数最多三条，面板在 `styles/game.css` 里限高并可滚动，确认按钮永远不会被挤出画面。桌面调试时键盘 Enter / 空格仍然走同一个 `confirm()`，但这是给键盘的便利，不写进文案。

卡片与推镜都是**真正的暂停**：`game.js` 的帧门在 `state.tutorial.frozen` 为真时跳过单位、投射物与生成，并让 `readControls(delta, true)` 读到空输入（战车惯性滑停，而不是整体冻住）。否则视野外的弓手会在你不能操舵的时候先放箭。镜头用 `updateCamera({ ..., focus })` 的 `focus` 点推镜，缓动比跟随更慢；`state.cameraFocus` 为 null 时恢复跟随战车。

撤离点的门是**剧本说了算**：`state.tutorial` 还没清空时，`game.js` 的撤离判定一律关闭；两阵都倒下时 `finish()` 把 `state.tutorial` 置空，通用规则（首领倒下，或击杀数 ≥ `objectiveTarget`）就在同一帧接管，所以门本身还是那一行老判断，只多了一个「场景还在演」的否决。`stages.js` 仍写 `objectiveTarget = 1 只虎 + 7 + 14 = 22`，但它在这一战里只是 HUD 计数器的上限（HUD 实际显示的是当前这一阵的 `tutorial.hud`），不再是把玩家放出去的那把钥匙——否则打到第 8 个人就能绕过后面两阵。`tutorial.noteOrder()` 与 `finish()` 也只改剧本自己的字段，从不碰 `state.kills`。

老虎是「野兽」而不是士兵：`src/data/wilds.js` 一行数据，走 `state.enemies` 同一条管线（移动、受伤、掉落、绘制都复用），另有两列是它独有的 —— `species`（同族互不攻击；正式战局的每一行都不写这一列，因此目标选择逐帧不变）与 `loot: "meat"`（掉落肉而非铜钱，拾取回 4 点耐久，且是唯一不掷随机数的掉落，野兽因此不会偏移播过种子的战场）。它没有 `formationId`，所以阵旗与阵型警报都跳过它；脑子是 `behaviours.js` 里的 `wild`：见到谁就冲谁，近身就咬，不会退。

地图生成分两步：`map.js` 的 `rollBattlefield()` 只负责掷出一整张战场，`createBattlefield()` 再把这张战场交给场景自己的**地图检查**（`validate` 回调）—— 检查不通过就整张重掷（最多 12 次）。正式战局传 `null`（即「没有要求」的空白检查），因此 `?seed=` 的战场仍是原来那一张、连随机数消耗都不变；教学战传 `src/game/tutorial-map.js` 的检查，它问三件事：虎的落点周围 26px 无遮挡；从出生点到虎都有可走的通路；以及**从这张图上任何开得过去的位置**，三支阵型（乱军先锋、族中援兵、乱军精锐）都各自找得到一整块无遮挡的落脚矩形（4×3 的格点采样，取不到的格点（被墙封死的地面）不参与要求）。三块地是分别问的，不是拿最宽的那块代表全部：放得下精锐的图自然放得下先锋，但只放得下先锋的图也必须拒——剧本没法打到一半重掷。这些判定都用 `src/game/reachability.js` 的 `buildWalkMap()`：以玩家体积在 60px 网格上做四邻洪泛，一次洪泛回答「这里能不能开过去」和「哪些地面算数」。虎是出生点的纯函数（车前 470px），所以检查与真正生成说的是同一块地；**三支阵型都不是**——它们各自在上一拍结束时列阵，落点是「当时战车所在位置」的纯函数：`layOnLadder()` 沿固定的方位 / 距离阶梯（先锋与精锐 900 → 420，援兵 560 → 420）取第一块既无遮挡、又开得过去的矩形，还要避开场上已有阵型的包围盒（精锐列阵时援兵还站在那儿），全程不掷骰子，因此同一张图、同一个站位永远得到同一支阵。追着老虎跑到地图另一头的玩家不会被镜头拉回出生点，阵线会在自己身边列阵；援兵则从相反的方向（方位 -2.1，约 560px）开来，因为玩家刚往 0.62 那个方向打出去，镜头不该把他送回刚打完的战场。

战场本身是「回」字形的四层环带，比例也是数据：`src/data/rings.js` 只写下 A/B/C/D 四条环带各占多少（默认 20/45/20/15），外加 `innermostSpan`——它说明中心带的那 20 是「中心到边的一半」还是「一条厚度」，两种读法差 560px 的中庭。`src/game/rings.js` 在每次开战时把这张表换算成像素几何（`ringAt()` 只需要一个 `t`：以中心为 0、以世界边缘为 1、取两轴中更大的那一个），掷地图、刷新点与将来的调试叠层都读同一份推导 —— 一张表、一处推导，没有第二处能跟它不一致。比例随时可改：改表即改下一战的地图，或者用 `?rings=10,40,30,20` 只为这一次启动换一组比例（任何正数刻度都行，函数会归一化）；比例和不为 1、或中心带留不下外侧三环时，`resolveRingHalves()` 直接抛错，而不是悄悄生成一张有洞的地图。

撒点不再是在整张地图上均匀取点，而是先选环带再在环带内均匀取点：`src/data/ring-elements.js` 给每一类元素一张「哪一环长得密」的表（`high`/`medium`/`low`/`none` = 3/2/1/0，乘以该环自己的面积），`map.js` 的 `ringWeightsFor()` 把等级换算成权重、`placeInBand()` 先抽一环再抽一点，于是芦苇荡的水落在中环与外环、树木集中在中带、栅栏贴边，「回」字的层次不需要生成器里任何一个 if。等级乘的是**环的面积**而不是环的数量，所以 `high` 说的是密度：把中带改窄，树会往外挪，而不是被挤成一堵树墙。预算仍然只管数量：`obstacleTarget`、`terrainKinds[*].placement.count` 与 `obstacleAttemptCap` 决定撒几个、最多试几次，被拒绝的落点不吃名额（重试仍落在同一类元素的下一环里）；贴边的横向栅栏不再被丢弃，而是往内挪进边距——边距之上正是栅栏该待的地方。每环另有覆盖上限（`ringCoverage`，占该环面积的百分比），它只在比例被推到极端时说话：某一环被指定成年年长满树时，它会在变成一堵实心树墙之前停止接收。

地板本身是一层单独的画：`src/render/ground.js` 只画地面，颜色全在 `src/data/elements.js` 的 `groundVisual` 里 —— 一层底色，加上每格一块柔和的「翻过的土 / 阴影 / 晒白的浮土」，再按更细的格子长出稀疏的短草或落一粒土渣。这里故意没有网格：被它换掉的 40px 网格线是全场地最硬的边缘，而低对比的地面最经不起这种边缘。每一格都由自己的世界坐标哈希出来（`src/utils/math.js` 的 `hashNoise`），不用 `Math.random`，于是同一块地每一帧画得一模一样（`H5_TRACE_DRAW` 摘要仍然可比），而格子锚在世界坐标而不是屏幕上，镜头移动时纹理是「滑过去」而不是「跟着走」。地表块随后盖在地板之上并向它羽化：`visual.fill` 是中心的颜色、`visual.fade` 是同一颜色的零透明度版本，绘制时先把坐标系压扁，渐变才会贴着椭圆走到边缘、正好在自己的边界上归零（否则短轴那一圈会留下硬边）。草块（`terrainKinds.grass`）的 `visual.kind` 现在是 `weeds`：一丛按哈希摆位的草叶，外加几根带穗的高草，高度按地块半径的比例给，所以大块是「更高」，不是「更稀」。地板之后依次是地表块、血迹与树桩、障碍、单位、特效，云影压在最后一层（`draw()` 里的 `drawSky()`）：它半透明，所以能从整场之上飘过而不遮挡任何东西；反过来说，任何东西画在它之后都会变成「云在树后面」的那种错，单测因此把「云之后只剩云自己那两笔」钉住了。


钱与战功在重试时只会回滚到「本战开局时的军资」：`campaign.entryGold` 在每次 `createBattle()` 里快照，`restartStage()` 把它还原（打到一半倒下时，这一战路上捡的钱不算，之前各战存入的钱不动），教学战重试还会清掉 `campaign.tutorialHandoff`。教学战本身的战功正常计入这一局；`arm()` 以 `state.battleId` 为键，因此暂停、切语言、失焦回来都不会把开场再演一遍。

## 终局与休战

一局有多长，在抽姓名的同一刻就已定下：`startRun()` 先抽姓名，再用同一条 `campaign.random` 抽终局战局（`campaignRules.finalStageMin` 起始、`finalStageSpan` 跨度，即第 10–13 战局之一），之后 `createBattle()` 才重新播种。抽签发生在播种之前，所以 `?seed=` 仍然逐帧复现同一场战斗，而一局的长度本身逐局不同。终局由战局号单独判定（`stages.isFinalBattle()`）：即使间隔规则本不认为它是首领战，终局也一定是首领战。序章的第六行由这条抽签补上（`prologue.final`），`#prologue-final` 在没有终局时保持 `hidden`。

终局的首领不再是随机一位，而是 `campaignRules.finalSquad` 里的固定阵容：两面象兵、两位狮王馭者、四辆投石车，按 784 点总耐久（本作的 `bossTypes` 表：2×204 + 2×78 + 4×55）环绕玩家列阵。`enemies.spawnBossSquad()` 让每位首领各占一个方位，被地形挡住时逐级收小半径；确实无处可放时退到夹取后的落点，而不是在终局中途抛错。终局仍会刷新普通敌军，因此它的编队上限单独放宽到 `finalStageEnemyLimit`（52），否则八名首领就会把普通波次挡在门外。`state.bosses` 保存整支车队（阵亡者也留在册上，便于统计），`state.bossDefeated` 只在**最后一位**倒下时为真——这是开启撤离点的唯一条件。

战场 HUD 用 `ui/labels.js` 的 `stageLabel()` 决定战局栏写什么：平时是两位数字，终局改写 `battle.finalStage`（中文「终局」、英文 `FINAL`），并带上 `.is-final` 让样式把字号收小一档，以免五个字符撑破原本只放两位数字的格子。本役目标栏在首领战里显示整支车队的总耐久（`battle.bossSquad`，例：「8 将 · 象兵」），条随每一具倒下而下降；预警横幅在终局读作 `battle.finalWarning`，副标题为 `battle.bossSquadBanner`。

走到撤离点在终局不再开店，而是 `stages.enterVictory()`：战利先入军府，`setMode("victory")` 打开凯旋卡——它是战场那张唯一的卡（`#battle-card`，`ui/battle-card.js`），与暂停卡、失利卡、教程卡同一份 DOM、同一套样式，只是 spec 不同：`copy` 是这一局的名字与战局数（`data-tone="lede"`，读作引题），列表里两行写战功与军资、以及接下来要休整多久。卡片唯一按钮回到主菜单，此时菜单上画在卡片里的「击鼓出征」已被同样画在画布上的休战卡取代：它只有两行文字、没有登记任何可点的目标。

休战记录写在 Local Storage 的 `chariot-wars.victory.v1` 上，经由 `src/platform/storage.js` 的门面（浏览器驱动把载荷写成 JSON 文本，读取时由 `parseVictoryRecord()` 校验每一栏）。写入发生在 `enterVictory()` 内、卡片出现的同一刻，所以即便玩家在凯旋卡上直接关掉标签页，这一局也算赢了。窗口长度只有 `VICTORY_LOCK_MINUTES` 一处：`VICTORY_LOCK_MS` 与卡上的每一段文案（`menu.timeHours`/`menu.timeMinutes`/`menu.timeSeconds` 等）都由它派生，单测会断言这层派生关系。当前构建把它设成 1 分钟，以便在真机上一口气看完「锁定 → 倒计时 → 到期 → 再出征」；把 `src/game/victory-lock.js` 的 `VICTORY_LOCK_MINUTES` 改成 `24 * 60` 即为上线的二十四小时。到期时键会被删除而不是留在存储里；窗口尚在时再次胜利不会延长等待（以第一次胜利的时间戳为准）；记录损坏、缺栏，或时间戳比现在晚出 60 秒以上（时钟被回拨、或被人改过）时，一律按「没有记录」处理——这样的时钟只会让玩家少休一次，不会把存档锁死。它是节奏装置而不是反作弊手段：改系统时间或清站点数据都能绕过。

主菜单也是一张画布（`ui/menu.js`、`ui/menu-layout.js`），照着小游戏端的首页做：一张 550×380 的居中卡片，上方依次是引题、标题、金印与两行引言，卡片底部是 224×50 的「击鼓出征」。它同样跑自己的帧钟（页面打开时才开始，关掉就停），休战卡就是同一个位置画成的两行卡——写清还要等多久、上一局是谁打到第几战局、拿了多少战功——并且**不登记任何命中矩形**，因为它没有可点的东西。倒计时于是不再是「每秒变一次的字符串」：画布每帧重画，`ui/screens.js` 里那份只在文案变化时写 DOM 的 `paint()` 也随之消失，`setMode("menu")` 只负责让 `victoryLock.refresh()` 重读一次存储。画布对屏幕阅读器是不透明的，所以倒计时会按「变化才播报」的规则镜像进 `#menu-live`，而「击鼓出征」保留了一个不可见、不吃指针事件的焦点替身 `#menu-start`：它每帧被挪到画出来的按钮上，Tab 与 Enter/空格仍然按老路径（`ui/controls.js`）出发，`:focus-visible` 时露出焦点框，玩家看到的位置就是画出来的位置。开新局前的门槛因此有两条：画布上换成休战卡（替身同时被隐藏并禁用），`startRun()` 自身也会 `releaseIfExpired()` 复核一次，所以一个残留的按键或点击不会绕到序章后面。开发时用 `?reset=1` 可以只为这一次启动清掉记录（与 `?seed=` 共用 `launchQuery()`）；它不清别的任何东西。

## 操作

- **W / A / S / D** 或方向键：模拟摇杆，方向代表地图上的移动方向；战车会平滑转向并沿车头前进
- 松开方向键：战车凭惯性减速至停止
- **空格**：发射弩箭，按住的时长决定是哪一种。按住不足 0.6 秒就松开是短射：弩手自动挑出车头前方 ±60° 锥形内、视线畅通、380 px 以内最近的敌人，按这个实际距离解算弹道，因此近身也能落在目标身上，而不是从它头顶飞过去；锥形内没有敌人时照常射出，只是不带辅助瞄准。按住 0.6 秒以上再松开是原有的长程固定弹道，射得比短射更远，用于压制远处目标
- **P / Escape**：暂停或继续
- **触屏**：摇杆方向就是地图移动方向；战车会平滑转向，松开摇杆后凭惯性减速；使用发射键攻击，按下即开始蓄力（外环显示蓄力进度），按住不足 0.6 秒松开是上面说的短射，按住更久再松开是长程固定弹道
- **触屏反向小输入**：静止或慢速时，朝车头后方约 135° 以上轻推摇杆（幅度不超过 0.45），战车会沿车尾方向倒车，并带一点后轮转向：车头以约 42°/s 的慢速转向摇杆的反方向，也就是车尾跟着摇杆摆；斜向倒车因此沿弧线并入摇杆方向（最多摆 45°，约 1.1 秒），推满摇杆仍是原来的转向

每个战局只有一次挑战机会，不再有三辆战车的复活次数。战车耐久耗尽后将下车继续作战：WASD / 方向键直接移动步卒，空格挥剑。驾驶员固定随车，不占车员名额且不攻击；招募的弓手会自动射箭，戟士会自动近战，二者均可在步战中阵亡。阵亡车员不会自动补充，可按相同价格重新招募。车箱等级决定车员名额：初始 1 个，升级后为 3、5、9 个。战马初始 1 匹，最多 4 匹，提供机动加成。步卒阵亡则本役失败；可重试当前战局，保留已购装备和已收军资。

凯旋商店的「招募车员」页还可以雇一队募兵：1000 两一队，最多两队，占的是营地而不是车员名额。每队七人——四名矛手、一辆战车、两名弓手——按你起步的朝向列在车侧的空地上，步卒只守阵脚（最多前出 150px、离位不超过 70px），弓手站在后排放箭。阵旗是双方阵型共用的机制：每 3 秒为站在虚线圈内的本阵成员回复 1 点耐久；阵亡的士卒在下一战重新补齐，雇来的队伍不会消耗军府车员，也不会因一次战败而消失。募兵的战车沿用敌车数据（14 点耐久）：耐久降到 20% 或以下时向阵位撤退，回到阵中借阵旗回血，超过 40% 才再次出击；若撤退途中被近战缠住，则进入 FIGHT_TO_DEATH，此后永不再逃。这套士气循环不在募兵里私有：`units/chariot.js` 是双方共用的状态机（`nextChariotState()` 只读血量与视野，输出 HOLD/ENGAGE/REGROUP 三种意图，阈值集中在 `chariotTactics`），敌军的冲撞战车与募兵车只在「腿」上不同——募兵被缰绳拴在阵位，敌车退回自己的队列空位；两边都借本阵阵旗回血，超过 40% 才再次出击，撤退途中被近战缠住同样进入 FIGHT_TO_DEATH。溃逃、回差（hysteresis）与困兽死战完全同源，改一处两边同时生效；阵旗的计时、治疗与脉冲也只有一份：`units/formations.js` 的 `tickFormationAura()` 同时驱动 `state.formations` 与 `state.allyFormations`（敌军的 `chariot-archer` 仍走弓手脑子：它面对压力的答案是拉开距离，而不是死战）。商店的营地预览会为每队竖起一顶帐篷；开局布阵不消耗随机数，因此 `?seed=` 复现的敌军布阵不受募兵影响。

移动设备建议横屏游玩。战斗画面会铺满屏幕，并提供半透明摇杆与攻击键；战车阶段摇杆方向直接决定地图上的移动目标方向，战车平滑转向并沿车头前进，急转时会减速，松开摇杆后凭惯性减速至停止。静止或慢速（低于 32 px/s）时，朝车头后方约 135° 以上轻推摇杆且幅度不超过 0.45，战车会沿车尾方向倒退，同时带轻微的后轮转向：车头以约 42°/s 的慢速转向摇杆的反方向，车尾跟着摇杆摆，斜向倒退因此沿弧线并入摇杆方向（最多约 45°、约 1.1 秒）而不是瞬间横移；角度或幅度超出该范围时仍按原有方式转向。键盘输入固定为满幅，因此只走转向分支。步战阶段摇杆切换为直接移动，攻击键改为按下即挥剑：蓄力只属于车上的弩，下车后不会留下一段悬着的蓄力。摇杆在窗口尺寸变化时保持显示，摇杆内的细环标出的正是反向小输入的半径。所有箭矢和石弹都会飞完全程落地，不会在半空中凭空消失：弓箭落地后会短暂留在地面，石弹无论落在空地、被墙木挡住还是命中目标，都会扬起浅色尘土并留下扩散的冲击环（战场草色偏亮，尘土因此使用更浅的色调，时长也长于普通火花）。玩家和随行车员受伤时也会留下血迹。已招募的弓手和戟士会在下车后跟随玩家并自动攻击；初始驾驶员不攻击，也不作为步战援兵。

战车属性为火力、防护、机动、稳定、容量，初始为 3 点（容量 2 点），范围为 1–10。火力决定弩箭伤害（火力 × 1.5）；防护按属性值 × 5% 概率完全抵消一次针对整辆战车的远程攻击；机动乘数为 0.5 + 机动 × 0.05；稳定决定战车耐久（稳定 × 10，初始 30 点）；容量仅供显示，车员名额由车箱升级决定。五件装备各有三级，后续等级会按配置明确带来属性惩罚；战马只增加机动。凯旋商店显示五项属性与购置预览，装备、马匹和人员价格均由配置表提供。这些换算集中定义在 `src/data/rules.js` 与 `src/data/equipment.js` 的派生函数中。

战车高速正面冲撞可对可冲撞的敌人造成伤害，基础为 1 点；每级轴与轮辋升级额外增加 2 点（Lv1/Lv2/Lv3 分别为 3/5/7 点）。普通接触不造成冲撞伤害，重甲单位等免疫冲撞伤害的敌人仍不会受伤。机动和战马只影响战车速度与转向，不会直接增加冲撞伤害；弩架只提高弩箭伤害。

冲撞步卒或弓手会将其撞倒，片刻后重新起身；重甲步卒可被撞倒，但不会受到车轮冲撞伤害，仍可被武器击伤。高速冲阵会以醒目的金色冲击特效刮伤敌军，并受到密集步卒反击。敌军刀剑与戈的近战攻击有不同的挥击特效，也会伤害车体；步卒会在攻击距离保持稳定，不再贴身前后抖动。战场上有轻薄、缓慢飘移的云影，画在最后一层（树冠、车身、血条都在它们之下），只靠透明度存在：整场之上飘过，从不遮挡任何东西。战马数量由购置决定，最多四匹，战马可见地随战车行进。敌方弓手、投石兵和弓车会在视线畅通时发射带抛物线的箭矢或石弹；墙木会遮挡低空弹道。战场上有浅滩、沙地和草地，分别会显著、中度和轻微减慢所有单位。步卒编队会护住后排远程单位，只在战车未进入阵型范围时保持阵线；战车一旦驶入阵型范围，整条阵线会一起压上来，追出有限的距离后收兵回位，不会无休止地追击，也不会被逐个引走。第 4、6、8… 战局会出现象兵、狮王馭者或投石车首领，首领战仍会持续刷新普通敌军；击败首领后前往撤离点。每一局还会在开战前抽定一个终局战局（第 10–13 之一），那一战必定是首领战：两头象兵、两头狮王馭者与四辆投石车同时结阵而来，且当战局标签改读「终局」，战绩栏的血条统计的是整支车队，而非某一位首领。八名首领全部倒下才开启撤离点；走到撤离点不再是开店，而是以凯旋卡结束这一局。受伤单位会在地面留下有限数量的血迹。战车遭受弩箭、战车冲撞或高速撞上障碍会损伤车体；耐久耗尽后下车继续作战。敌军会掉落铜钱、银锭或金饼，接触拾取；达成目标后，未拾取的战利也会在凯旋时收归军府。

## 声音

音效不是代码里合成出来的方波，而是 `src/assets/sound/` 下的真实素材，按**文件名**约定驱动：

```text
src/assets/sound/player/footstep_1.wav     # <cue>_<n>：同一个 cue 的多个版本，播放时轮转
src/assets/sound/player/wave_up.wav        # <cue>：只有一条
src/assets/sound/player/chariot_moving_loop.wav   # <cue>_loop：循环，直到被要求停下
```

`player/`、`units/`、`weapon/`、`ambient/` 只是给人看的分组，引擎只认文件名。新增一个版本丢进任意分组即可自动加入对应的 cue；新增一个**事件**才需要在 `src/data/sounds.js` 的 `soundCues` 里加一行。三层分工：

- `src/data/sounds.js` 是唯一写着文件名的地方：`soundFiles`（31 个文件）、`soundCues`（26 个 cue 的语义名）、`soundMix`（每个 cue 的音量 / 同时发声上限 / 最小间隔）、`soundBorrowed`（还没有专属素材、暂时借用的事件，每行都带 `TODO(sound)`）、`soundDeathCues`（按 `visual.kind` 选死亡音）、`soundPurchaseCues`（按购买类型）、`soundscapes` 与 `resolveSoundscape()`（菜单 / 战局 / 首领战 / 夜营各响什么）、`soundCadence`（脚步每走 26px 一声）。
- `src/assets/audio.js` 是播放决策，对外只有六个方法：`play(cue)`、`setState({ mode, boss, moving })`、`stop(lane?)`、`setEnabled(flag)`、`unlock()`、`inspect()`。它负责轮转换版本、限流、声道上限与循环声道（`ambience` / `motion` / `fire`）的交叉淡入淡出，并且**不消耗 `campaign.random()`**——所以加一个音效不会改变任何一场播种战局的走向。`inspect()` 只给试听页和测试用，返回每条声道的 `{ lane, cue, kind, paused, volume, at }`；`paused` 是浏览器真正有没有在放，这一条播放器自己看不出来，而一首被自动播放策略拦下的背景乐和一首正常播放的背景乐听起来都是「安静」。
- `src/platform/audio.js` 是唯一提到 Web Audio 与 `<audio>` 的文件，负责解码缓存、上下文解锁（浏览器只允许在用户手势里启动音频）以及「这台机器根本没有解码器」时的静默降级；小游戏端只需在同一层实现这些方法。手势到达时被拦下的氛围声用 `resumeStream()` **原地续播**（位置、音量都保留），而不是停掉重开——重开会把 30 秒的背景乐每次都从 0:00 开始。`game.js` 因此保留整个会话的 `pointerdown` / `keydown` 监听：进入战局这种没有手势的换屏会让浏览器拒播，而下一次按键或点击才是把它接回来的时机。

只有两条播放通道：短音效与两个短循环（战车滚动、篝火）走 `AudioBuffer`；两个 30 秒的战场氛围走 `<audio loop>` 流式播放，因为解码进内存每个要占约 11.5MB（`AudioBuffer` 是 32 位浮点），而流式播放几乎为 0。

素材由 `node scripts/transcode-audio.mjs` 统一成 **22.05kHz / 16bit / 单声道 PCM WAV**：`decodeAudioData` 不需要任何编解码器（Chrome、Firefox、Safari、小游戏一致），PCM 没有编码器补白所以循环无接缝，单声道让解码内存减半。脚本还做两件事：把双声道**平均**下行混音（`afconvert -c 1` 只保留左声道，`wave_up` 左右差 3.3dB，直接丢掉右声道会变薄），以及把所有音效的峰值归一到 **-3 dBFS**（源素材从 0 dBFS 到 -27 dBFS 不等，不归一的话撤退点提示几乎听不见）、给 `_loop` 文件两端各加 8ms 淡入淡出（否则循环接缝会「咔」一声）。原始文件归档在 `assets/audio-source/`（已 gitignore），可以随时 `--force` 重转。整体体积 13.6MiB → 1.59MiB，加上两个氛围 mp3 共 **2.96MiB**；唯一超过 5 秒的 `player/victory_sounds.wav`（20.04 秒 96kHz，11.5MB）已删除，凯旋音暂时借用商店升级音，记在 `soundBorrowed.victory`。

`ambient/` 是唯一不进这条管线的一组（两个 30 秒 mp3 直接流式播），所以也是唯一没人量过的一组——而一首空响的 mp3 结构完全合法。`node scripts/transcode-audio.mjs --levels` 就是补这个盲点：只读不写，把每个上架文件（含 `ambient/`）解码后打峰值与 RMS，比整组中位数还低 12dB 以上的点名。它现在的输出就是那个悬而未决的缺陷：`default_map_background_loop.mp3` 的 RMS 是 **-58 dBFS**（整组中位数 -26 dBFS，首领战那首 -25 dBFS），且 120Hz 以下没有任何能量——菜单与战局的氛围因此一直是静音，而这不是音量能修的，需要换回原导出文件。

试听页：`node scripts/serve.mjs` 后打开 <http://localhost:8000/scripts/audio-lab.html>，逐条 cue 与逐个文件都能直接播（含混音与限流），挑替身不必靠猜。页首的声道表每 500ms 刷一次，`paused` 行标红；「菜单 / 战场 / 首领 / 营地」四个按钮按真实声道起停背景乐，和游戏里走同一条路径，所以「为什么听不到氛围」在那里一眼就有答案（是被拦了，还是文件本身就是空的）。迁移到别的引擎时用 `node scripts/export-audio-manifest.mjs --out audio.json` 导出同一份注册表（cue、文件、时长、音量、限流、仍借用的事件），不用再手写一份清单。

小游戏分包时把 `src/assets/sound/ambient/`（1.4MiB）放进子包，主包只剩 1.6MiB 音效，仍在 4MB 门槛内。

## 项目结构

```text
h5game/
├── index.html
├── README.md
├── scripts/
│   ├── audio-lab.html           # Audition page: every cue and every drop, played through the real player
│   ├── audio-lab.js             # ... its wiring (open it via scripts/serve.mjs)
│   ├── dom-stub.mjs              # The one browser global the gameplay modules read at import time, so the tests can load them
│   ├── export-audio-manifest.mjs # The sound registry as JSON, for a port to another engine
│   ├── transcode-audio.mjs       # The asset pipeline: 22.05 kHz / 16-bit / mono PCM, peak-normalised, loop edges sealed
│   ├── perf-test.mjs             # Frame-budget benchmark for the per-frame loops
│   ├── smoke-test.mjs            # Boots main.js against a stub DOM: menu → prologue → battle → shop (hire a line) → defeat → the last stage → victory card → resting menu → the tiger drill
│   └── unit-test.mjs             # Rules, collision, pathfinding, ballistics, bow aim, blood, RNG, naming, shop geometry, hired formations, the last stage, the post-victory rest and the tiger drill
├── styles/
│   └── game.css
├── src/
│   ├── main.js                   # Browser entry point
│   ├── i18n/
│   │   ├── index.js              # Loads the JSON resources, locale selection, translation and DOM updates
│   │   └── locales.js            # Locale registry plus lookup/fallback rules (no copy)
│   ├── utils/
│   │   ├── freeze.js             # Recursive deepFreeze for the data tables
│   │   ├── math.js               # Shared clamp and distance helpers
│   │   └── random.js             # Seeded PRNG for reproducible battles
│   ├── data/
│   │   ├── battlefields.js       # Battlefield names, ground labels and per-map element mixes
│   │   ├── elements.js           # Map element catalog: one row per obstacle, terrain and cloud kind
│   │   ├── ring-elements.js      # Where each kind grows: one level per ring, plus the per-band coverage caps
│   │   ├── rings.js              # The 回 table: band shares, what a level means, and the `?rings=` parser
│   │   ├── equipment.js          # Equipment, horse and personnel values; derived stat helpers
│   │   ├── formations.js         # Formation patterns, unit/boss stats, shared chariot morale and banner aura
│   │   ├── names.js              # Frozen clan/given name tables (weights + story keys)
│   │   ├── rules.js              # Balance constants for stats, projectiles, impact effects and campaign pacing
│   │   ├── sounds.js             # The sound registry: files, cues, mix, death/purchase tables, soundscapes
│   │   └── wilds.js              # Wild animals (the tiger): one row each, with `species` and `loot`
│   ├── game/
│   │   ├── game.js               # Composition root: wires systems and owns the frame loop
│   │   ├── loop.js               # requestAnimationFrame loop with failure isolation
│   │   ├── state.js              # Player, campaign, and battle state creation
│   │   ├── map.js                # Procedural battlefield scatter: rings pick the band, the budget keeps the count
│   │   ├── rings.js              # The 回 geometry derived from data/rings.js: bands, `ringAt`, band sampling, weighted picks
│   │   ├── reachability.js       # Abstract map check: a flood fill over the rolled field's obstacles
│   │   ├── tutorial.js           # 猛虎下山: the drill's step machine (cards, pans, targets, the loaned squad)
│   │   ├── tutorial-map.js       # Where the tiger stands, where the three lines are placed from the chariot's live position, and the map check
│   │   ├── stages.js             # Campaign stages, objectives, extraction, the drawn last stage and the victory hand-off
│   │   ├── victory-lock.js       # The post-victory rest: one storage key, one window, expiry and clock-skew handling
│   │   ├── identity.js           # Weighted name roll: one clan, one given name, their story keys
│   │   ├── collision.js          # Obstacle/terrain collision, movement clamping, the movement broadphase, indexed line of sight
│   │   ├── pathfinding.js        # Grid routing for every non-player unit: one clearance field, typed-array A*, the per-frame gate
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
│   │       ├── enemies.js        # Enemy/boss/wild spawning, damage, and collision
│   │       ├── allies.js         # Hired friendly line: spawn and guard, plus the drill's borrowed squad
│   │       ├── chariot.js        # Shared chariot morale: CHASE -> FLEE -> FIGHT_TO_DEATH
│   │       ├── behaviours.js     # One brain per unit type: sight response, guard post, chase, the wild charge
│   │       └── formations.js     # Shared formation logic: leash, alerts, banner aura
│   ├── render/
│   │   ├── camera.js             # Player-follow camera (clamped delta, self-healing, optional focus point)
│   │   ├── elements.js           # Element art: palisades, canopies, terrain patterns, cloud puffs
│   │   ├── ground.js             # The floor: soil washes, grass flecks and grit, hashed onto the world
│   │   ├── sprites.js            # Unit art: chariot rig and foot figure, shared by battlefield and shop
│   │   └── renderer.js           # Canvas rendering for terrain, units, and effects
│   ├── platform/
│   │   ├── audio.js              # Host seam: the only file that names Web Audio / <audio>; decode cache, unlock, graceful silence
│   │   ├── launch.js             # Host seam: `launchQuery()` reads `?seed=`, `?reset=1` and `?rings=` (小游戏 reads wx launch options)
│   │   └── storage.js            # Storage facade over `window.localStorage`: JSON payloads, a cache, never throws at the game
│   ├── assets/
│   │   ├── clan/
│   │   │   ├── clan_names.json   # Clan names: weight, story key and naming source per row
│   │   │   └── given_names.json  # Given names: weight, story key and naming source per row
│   │   ├── i18n/
│   │   │   ├── zh-CN.json        # Simplified Chinese copy (one flat key per message)
│   │   │   └── en.json           # English copy, key-for-key with zh-CN where translated
│   │   ├── sound/                # The drops, named <cue>[_<n>][_loop].wav (pipeline: scripts/transcode-audio.mjs)
│   │   └── audio.js              # The sound player: cues in, sound out (play/setState/stop/setEnabled/unlock)
│   └── ui/
│       ├── elements.js           # DOM element registry
│       ├── controls.js           # Keyboard, touch, and screen event bindings
│       ├── hud.js                # Battle HUD updates, including the FINAL readout and the squad health total
│       ├── labels.js             # Pure label helpers: the stage readout, the countdown and the rest's window
│       ├── prologue.js           # The story card: five lines from the rolled identity, plus the stage the run ends on
│       ├── screens.js            # Which screen is up, and which card it puts over the field
│       ├── battle-card.js        # The one card: one spec per dialog, one DOM painter (pause, defeat, victory, the drill)
│       ├── canvas-page.js        # The shared canvas host: backing store, page clock, pointer router, live region
│       ├── menu-page.js          # The home page's wiring: the painter, the start hook, 出征's focus proxy
│       ├── menu.js               # Home page paint: the card, the seal, the lede, 出征 or the resting countdown
│       ├── menu-layout.js        # Pure geometry for the home page card, ported from the mini game's numbers
│       ├── shop-screen.js        # The shop page's wiring: what to draw, what a tap means, what opening resets
│       ├── shop.js               # Shop page paint: header, tabs, rows, buttons, notice, the one info block
│       ├── shop-dossier.js       # Left column: five-axis radar, the team, the crew tab's night camp
│       ├── shop-scene.js         # The chariot rig and the camp fire, fitted into a rect
│       ├── shop-layout.js        # Pure geometry: rows, radar axes, rig fit, camp seats
│       ├── theme.js              # The shop's palette, radii and the two font stacks
│       └── widgets.js            # Canvas primitives: panel, text, wrap, button, fit, hit test
└── assets/                       # Archived audio masters (assets/audio-source/, git-ignored)
```

界面支持简体中文和英文，默认使用简体中文。文案按语言放在 `src/assets/i18n/zh-CN.json` 与 `src/assets/i18n/en.json`，每个文件是一张扁平 key 表；`src/i18n/locales.js` 只保留语言注册表与查找/回退规则（当前语言 → 默认语言 → key 本身），`src/i18n/index.js` 在启动时通过 ES 模块的 JSON 导入把这两份资源注册进去，并负责翻译、插值、静态 DOM 更新及语言偏好保存；语言切换不会重置战局。序章是这套规则的边界案例：姓名的两段汉字来自 `src/assets/clan/` 的数据表，任何语言下都原样显示，只有句式和名字由来走翻译 key（`prologue.*` 与 `namingStory.clan.reason.*` / `namingStory.given.reason.*`），并通过插值把姓名嵌进句子；切换语言只重绘同一张序章卡片，不会重新抽名。新增或修改界面文案时，需同时补齐两种语言，并使用稳定的翻译 key，避免在游戏规则或绘制逻辑中散落展示文字。公共纯逻辑仅在确有复用时抽取到职责明确的 `src/utils/` 模块。

本项目没有构建步骤或 package manifest，语法检查与测试都直接交给 Node（需 Node ≥ 22.12：文案资源用 import attributes 直接导入 JSON；浏览器端同样需要支持 JSON 模块，如 Chrome 123+ / Safari 17.2+ / Firefox 138+）：

```sh
find src scripts \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check   # 语法检查
node scripts/unit-test.mjs                       # 规则、碰撞、弹道、血迹、相机、随机数、姓名抽取、商店几何、募兵、终局抽签与休战
node scripts/smoke-test.mjs                      # 用 stub DOM 启动 main.js，跑战斗帧直到凯旋卡与休战后的菜单（含商店募兵与战场布阵）
node scripts/perf-test.mjs                       # 逐帧性能预算：敌军 AI、随从齐射、下车随从、弹道
node scripts/transcode-audio.mjs                 # 换过素材才需要：22.05kHz / 16bit / 单声道 + 峰值 -3dBFS + 循环收边
node scripts/transcode-audio.mjs --levels         # 只读审计：逐个量峰值 / RMS（含 ambient/），低出整组中位数 12dB 以上的点名
H5_SEED=7 node scripts/smoke-test.mjs            # 换一个随机种子复跑同一套冒烟检查
```

`H5_SEED` 只用于探索性复跑：冒烟脚本用固定输入脚本驱动固定帧数，个别种子在这个窗口里还没打中目标，于是 `score advanced past zero` 会变红（改动前的 `main` 上同样如此，与本次时间基准修复无关）。CI 固定使用默认种子 1。

`scripts/smoke-test.mjs` 以最小 DOM 桩启动真实的 `src/main.js`，跑数百帧并模拟移动与射击，用于在无浏览器环境下发现启动期与逐帧异常；它会固定 `?seed=1` 让每次运行逐帧一致，并通过 `window.__h5game` 校验敌军生成、坐标有限性与战局时间，而不只依赖 HUD 文本；首页也按画布验收——脚本先断言卡片画成了解锁态（引题、标题、最多两行引言）且不可见的 `#menu-start` 被挪到画出来的「击鼓出征」上，然后照着 `menuPage.lastFrame().startRect` 派发一次点按（坐标由元素比例反算回视图单位，与玩家真按下去的那一下同一条路径）落进序章：脚本断言姓名只由汉字组成、五行文案分别等于当前语言下的 `prologue.*` 与表里那两个 reason 键、此时目标标签仍是未命名的 `battle.objective`，再点「出征」确认战斗沿用同一身份、目标标签变成 `battle.objectiveNamed`，商店与下一战也不会换名；弩的两段手感也在这里跑：按住 0.75 秒松开必须走长程冷却、6 帧轻点必须走短射冷却，且锥形内没有敌人时依旧放箭，同时校验按钮的 `--charge` 与 `.charged` 随按住/松手切换。canvas 桩会把任何非有限数字的绘制调用记录为失败，因此在没有浏览器的环境里也能发现 `NaN` 变换。它不能替代真实浏览器验收，最终仍需按上文通过 HTTP 服务运行游戏确认画面与手感。`.github/workflows/checks.yml` 在每次推送与合并请求时执行其中三条命令（语法检查、单元测试、冒烟测试）；`perf-test.mjs` 是本地预算闸门，不放进 CI，因为共享 runner 的耗时波动会让阈值误报。

冒烟脚本最后还有一段“下车阶段”：先通过真实的“下一战”流程重开一场战局，买入一名弓手和一名长戈兵，再用真实的伤害路径把车体打空，于是 `dismountPlayer`、随从站位、随从寻敌与齐射都会真正跑起来。这段流程需要 HUD 之外的两个入口，因此 `window.__h5game` 额外暴露了 `combat` 与 `stageManager`（仍然只由测试脚本读取）。

`scripts/perf-test.mjs` 用同一套种子化的战场（46 个障碍、四支编队、满编随从）给每帧循环计时，并把阈值写在文件顶部的 `budgets` 里：敌军 AI、弓手齐射、下车随从、30 发弹道，以及单次 `hasLineOfSight`、单次寻路门控（直线畅通）和单次完整规划（直线被挡）的微秒成本。阈值是棘轮 —— 每一项都紧贴当前实测值，性能改动落地后要把它调低，注释里记着实测数与目标数。

商店页也有一条冒烟链路，而且它走的是玩家真正走的那条路：脚本用 `stageManager.enterShop()` 切进商店，之后只按画布自己在一帧里登记的命中矩形（`shopScreen.lastFrame()` 的 `rows[i].buyRect`、`tabs`、`next`）派发指针事件，既不查 DOM 商品卡也不点按钮。链路逐条走完：开页画出雷达、战车与页脚；按下一行先让雷达与车身预览（松手才扣钱），滑到行外等于取消，轻点则把这条说明钉住——购置会整页重画，钉住的说明必须还在；买不起的按钮写出价格而不是一个灰掉的「购置」；买下的行升一级，同一句话既进画布上的提示条也进 `#shop-live` 这个 `aria-live` 区域；切到车员页后篝火按营帐数搭帐，按住募兵多搭一顶、松手收回、买下就留着；页脚的「下一战」离店并领着这队募兵开上下一战局。单元测试不必开浏览器：`fakePageCanvas()` 给一块带 `getBoundingClientRect` 与指针事件的假画布，指针坐标按元素比例换算进 960 宽的视图单位，于是「按下 → 滑开 → 抬起」「买不起」「关页后不再排帧」「0×0 的画布是空操作」这些行为都能在没有 DOM 的情况下断言。雷达与车阵仍是纯几何，另有单元测试直接守住：`radarPolygon()` 必须等于 `calculateChariotStats()` 的五个属性值，任何装备加成或惩罚的 stat 名都必须出现在雷达轴表里，四种马匹数量（含满配底盘）的战车都必须完整落在版面交给它的矩形内，而且只有一种轴被填满——拟合是撑满而不是缩到角落里。

### 寻路与碰撞宽相位

移动查询和视线查询是同一种病：`moveEntitySafely` 让每个单位每帧问两次（逐轴各一次），满编战局就是每秒上千次全表扫描，而它想要的只是一个「这一步走不走得过去」。于是 `circleIntersectsObstacle` 也走一张均匀网格（96px，按元素自身的包围盒登记，查询时按圆的包围盒取格），`blocksMovement` 为否的元素不进这张表。键与视线索引相同 —— `campaign.obstacles` 的**列表身份 + 长度**，所以换战场和 `fellTree()` 都不用额外通知；而 `map.js` 边生成边查的那个还在长的数组会自动退回全表扫描（它的长度每次都变，给它建索引只会更慢）。`obstacleAt()` 仍然全表扫：它回答的是「是哪一个障碍挡住了我」，答案是列表里的第一个，格子的顺序会悄悄改掉这个答案。判定与全表逐点等价（单元测试 4000 个随机点 × 5 种半径对拍）。单次约 1.5µs → 0.05µs。

有了这张宽相位的底子，寻路才付得起账。`pathfinding.js` 整场仗只维护**一张 Float32 距离场**：`clear[格]` 是该格中心到最近障碍表面的有符号距离，上限 48，2800×1800 只要 12.3KB。它不是「通/不通」的布尔格，而是每格一个 clearance，于是同一张表同时服务全部四种体积（16/24/32/40，`radiusBucket()` 把 12~38px 的半径向上取到 8 的倍数），不需要按半径建多份掩码。建表按障碍画、不按格扫：46 个障碍各自写「包围盒外扩 48px」内的格子，实测 0.19ms，逐格扫全表要 4~5ms。列表一换（换战场、倒树）整张重建，每条路线都带着建表时的 generation，过期即作废。

搜索是八方向 A*，禁止切角（对角的两个直角面也必须装得下这个体积），octile 启发，节点上限 1200。起点与终点按 Chebyshev 两环吸附到最近的「装得下这个体积」的格子 —— 单位贴墙站时它自己那格本来就过不去，布尔格只能回答「堵住」然后把人困死，距离场加两环吸附把这个损失降到 0。每一步的代价乘 `1 + 0.3 × (1 - clearance/48)`，路线因此走缝隙中间而不是刮着墙；启发式仍是纯 octile，所以依然可采纳。

产出不是格子的台阶，而是航点：贪心拉直（从锚点往前伸，直到走不过去为止）把 60~90 格的锯齿压到约 2.7 个航点 —— 精确的 string-pull 每条路线要 400µs，是预算的十倍。但网格的值采在格中心，拐角处最多会把间隙高估半个格对角线（28px），所以**每条被采用的航段还要用真实几何复核**（每 12px 采样，直接问 `circleIntersectsObstacle` —— 前面那张宽相位表就是为了让它够便宜）：复核不过就退一格重试，退到一格还不过，就停在最后一个可达点，绝不把一段穿墙的线交给移动代码。实测 193 条随机路线里 2 段有 0.3px 级的采样残差，没有一段超过 2px。

同一个问题每帧问三次，越便宜越先试：① 手上这条路线还活着（目标移动没超过 24px、TTL 未到、没被判定卡住）就直接给下一个航点；② 直线畅通就把目标原样还回去 —— 绝大多数单位绝大多数帧走的是这一层，代价 0.27µs；③ 都不行才规划，且**每帧最多两次**（稳态需求约 0.8 次/帧）。卡住（0.3s 内挪不到 6px）、路线走完却还没到（多半是目标本身就落在某个障碍的余量里）、搜索失败，三种情况都丢掉路线并退避 0.3s —— 不退避的话，一个够不着的目标会让它每帧重新规划（实测 40 秒里规划了 1999 次）。时钟只吃 `beginFrame(delta)` 累起来的模拟时间，不读 `performance.now()`，所以 `H5_TRACE` 能逐帧复现。

接进去的只有非玩家的身体：敌军（推进、搜索、回岗、战车结阵）、雇佣阵线（`stepToward` 是唯一入口）、下车随从（跟队）。玩家自己开，`moveEntitySafely` 才是所有人的刹车，寻路只决定「往哪个方向走」。每个调用点都留了「没有寻路时的原样」：注入的 `paths` 为 `null` 时走的还是原来那条 atan2 直线，`stepToward` 返回的距离始终是到**真实目标**的距离（调用方拿它判断「到没到」），`searchWalk`/`walkHome` 的到达判定也仍量真实目标。`retreat()`（后撤）、`guardPost` 的贴身旁移、编队分离、玩家本体、`resolveInfantryCollision`、`separateAllies/Enemies` 一概未动。

行为上的收益实测：把 120 组「直线走不通」的起点/终点交给真实移动代码跑 40 秒，有寻路时 57 组走到（失败的 10 组里 9 组的目标本身落在障碍余量内、物理上不可达，另 1 组是体积挤不进的窄袋），没有寻路时只有 21 组。代价：单次规划 20~23µs（跨整图最坏 55µs），门控 0.27µs，敌军 AI 每帧 0.14ms、弓手齐射 0.16ms、下车随从 0.11ms、30 发弹道 0.06ms（后三项都比改动前更低，那是宽相位省下来的）。

和上一段不同，这次 `H5_TRACE` 的摘要**应该**变（`9243a9e5…` 对 `26e63db9…`）：第一处差异出现在第 1952 帧，是一辆正在追击的敌方战车换了个朝向。把 `paths` 换成一个只会返回 `null` 的桩，摘要与改动前逐字节相同 —— 所以差异只可能来自「路线真的带它绕了」，而不是哪一处算术被顺手改了。

两个回滚旋钮：`CLEAR_REWARD=0` 关掉贴墙偏好（路线更短、更贴墙），`MAX_PLANS_PER_FRAME=0` 关掉规划，只剩直线门控。


视线查询曾经是最大的逐帧热点：每次 `hasLineOfSight` 沿线段每 12px 采样一次，每个采样点都要遍历全部约 46 个障碍（约 1.5k 次形状测试），而一名准备就绪的弓手会为每个候选敌人各走一遍。现在 `collision.js` 在开战换列表时把“遮挡视线的”元素按格装进一张均匀网格索引（`campaign.obstacles` 换了列表或长度才重建），每个采样点只查自己所在的格子，判定结果与全表遍历逐条等价（单元测试用 500 条随机线段对拍）；`combat.js` 则把随从的冷却检查移到寻敌之前，装填中的弓手不再白算一遍视线。同一套基准下，单次视线从约 57µs 降到 0.6µs，弓手齐射从约 12ms 的突发降到 0.2ms，下车随从从约 9ms 降到 0.15ms，敌军 AI 从约 0.9ms 降到 0.25ms，而 `H5_TRACE=1` 的逐帧摘要完全不变 —— 这是一次只改代价、不改行为的重构。小游戏端同源同款，摘要同样不变。

两次同种子的运行必须打印同样的摘要：`H5_TRACE=1` 把每帧模拟数值折叠成一个哈希，`H5_TRACE_DRAW=1` 折叠每一次 canvas 调用（并统计调用次数），`H5_TRACE_LOG=<path>` 写出逐帧数值以便定位第一个分歧帧。重构渲染或地图生成时，用它们区分“有意改变”与“顺手改坏”：只搬代码的改动应当摘要不变，换了生成规则（例如按战场分配地表成分）则应当只变一次，并在提交说明里记下新的基线。摘要覆盖随从快照（血量、伤害、射程、冷却）、名册冷却和下车阶段，因此随从重构无法在“哈希不变”的情况下偷换数值。小游戏端 `scripts/headless-smoke.mjs` 用同一套字段、同一组 `H5_TRACE*` 变量输出摘要，两端可以互相对照。

时间基准只有一个写入者：`src/game/loop.js` 用帧回调自身的时间戳维护 `state.lastTime`，并把每帧增量限制在 `[0, 0.05]` 秒、非有限值按 0 处理。其它模块（包括 `stages.js` 的开战流程）只读不写 `state.lastTime` —— 过去用 `performance.now()` 打时间戳会让首帧增量变成约 -1.8e9 秒，把相机推到 `-Infinity` 再变成 `NaN`（`inView()` 全部为假，小游戏 iPhone X 上直接内存溢出）。`src/render/camera.js` 也独立兜底：增量同样限幅，且一旦发现自己非有限就重新贴回目标位置。冒烟测试在「出征」开战与恢复点击后立即断言这条契约（晚一帧就会被循环覆盖），所以这两处回归都会立刻变红。

在任意地址后加 `?seed=<数字>`（例如 `http://localhost:8000/?seed=7`）即可固定本局种子，战场、编队与掉落都会重演，便于复盘问题。`?rings=10,40,30,20` 则只为这一次启动换一组战场环带比例（见上文「回」字一节），两者可以并用：同一个种子加不同的比例，得到的就是同一串随机数落在不同环带上的地图。启动参数由 `src/platform/launch.js` 的 `launchQuery()` 读取，`game.js` 只把 `seedSource` 与 `ringSource` 注入 `createGameState()` / `createStageManager()`，`src/utils/random.js` 保持纯函数（`parseSeed()` / `createRandomSeed()`），因此引擎层不依赖 `location`、`URLSearchParams` 或 `wx`。`window.__h5game` 暴露 `state`、`player`、`campaign`、`world`、`view`、`camera`，仅供调试脚本读取。

Gameplay behavior is coordinated by `game/game.js`; specialized systems receive shared state and callbacks through small factories. `game/collision.js` owns obstacle/terrain queries, `game/combat.js` owns player fire and damage, `game/projectiles.js` owns ballistic flight and impacts, and `game/loop.js` owns the animation-frame loop with failure isolation. The loop is also the only writer of the time base (`state.lastTime`), clamping every delta to `[0, 0.05]` seconds and treating non-finite values as zero; `render/camera.js` re-seats itself if it is ever handed a non-finite position, so no single bad frame can poison the view for the rest of the session. Collision lives in one factory so player, enemy, and projectile code share the same geometry rules.

Particles have one lifecycle module, `game/particles.js`: `spawnParticle()` fills the fields every emitter used to repeat, `updateParticles()` and `pruneParticles()` advance and drop them, and `countParticles()` answers "how many of this kind are alive". The impact burst in `units/enemies.js`, the speed-scaled ground trail in `game/trails.js` and the frame loop in `game.js` all go through it, so a field that a copy used to forget - `maxLife`, say, which the renderer needs to compute alpha - cannot diverge between emitters. The trail itself measures speed from each unit's own displacement (`distance / delta`) instead of its `speed` field, which makes a hull pinned against a wall, a unit turning on the spot and a crowd being shoved stay quiet for free; a displacement pointing away from the nose is rejected, so a reversing chariot (and the drag of a knockback) leaves no wake. It draws no random numbers at all - a lateral offset and a palette step alternate instead - because every draw would come out of the battle's seed stream and move every enemy decision in the run. The cap (`effectRules.trail.maxLive`) and the off-screen cull keep a full formation from flooding the list, and the renderer paints the trail in its own pass under the bodies while the sparks, rings and motes keep their pass above them.

Map elements follow the same shape as units, one layer down: `data/elements.js` holds one row per kind (shape, whether it blocks movement and sight, its size ranges and its palette), `game/elements.js` is the runtime half that answers questions about an instance, and `render/elements.js` owns the silhouettes. Instances stay plain data - `{ type, x, y, radius }` for circles, `{ type, x, y, width, height }` for axis-aligned walls - and are resolved by `type` at query time, so a new kind is a row plus, only if the silhouette is genuinely new, one draw function. Rows are deep-frozen, and an instance whose type matches no row falls back on its own fields, which is what keeps hand-built test fixtures and older saves working.

The ground they stand on is a 回 pattern of four concentric bands, and its ratios are data too: `data/rings.js` holds the four shares (20/45/20/15 by default) and `innermostSpan`, which says whether the innermost share is a half-span or a plain thickness - the two readings differ by 560px of middle. `game/rings.js` derives the pixel geometry once per world and everything else reads that derivation, so there is one table and one derivation and no second place that can disagree with it; `ringAt()` needs a single `t` (0 at the centre, 1 at the world edge, measured on the further axis) to name the band a point belongs to. The shares are safe to edit at any time and can be replaced for a single boot with `?rings=10,40,30,20`; a table that cannot tile the world throws in `resolveRingHalves()` rather than producing a map with a hole in it.

The floor itself is its own painter, `render/ground.js`, and its palette is a data row (`groundVisual` in `data/elements.js`): one flat soil wash, a soft blob of turned earth, shade or bleached dust per lattice cell, and a sparse tuft of short grass or a speck of grit per detail cell. There is deliberately no grid - the 40px lattice it replaced was the strongest edge on the field, which is the one thing a low-contrast ground cannot afford. Every cell is hashed from its own world position (`hashNoise` in `utils/math.js`), never from `Math.random`, so the field paints identically on every frame and a `H5_TRACE_DRAW` digest stays comparable; because the lattice is anchored to the world and not to the screen, the texture slides past the camera instead of following it. Terrain patches then paint over that floor and feather into it: `visual.fill` is the tone at the middle and `visual.fade` the same tone at zero alpha, drawn under a squashed transform so the fade follows the patch's ellipse and reaches zero exactly at its own edge.

Elements are placed band-first: `data/ring-elements.js` gives each kind one level per band (`high`/`medium`/`low`/`none`, worth 3/2/1/0 times that band's own area), `map.js` picks a band from that table and then samples a point inside it, so water gathers in the outer bands, trees in the middle one and palisades on the rim without a branch in the generator. Because the level multiplies the band's area, a level means density rather than count: narrowing a band moves its share of trees outward instead of crushing them into a sliver. The budget still decides how many - `obstacleTarget`, each kind's `placement.count`, and `obstacleAttemptCap` for the tries - and a rejected point never eats a slot. A per-band coverage cap (`ringCoverage`) only speaks up at the extreme: point every kind at one band and it stops accepting before it becomes a solid wall of trunks. Two details are load-bearing. A palisade sampled on the rim is nudged inside the edge margin instead of being thrown away, because the rim is exactly where walls belong. And a band is sampled in exactly three draws whatever its size, so changing the ratios moves where the elements land without changing how many rolls the field costs - which is what keeps `?seed=` comparable across two readings of the same table.

Unit silhouettes are shared the same way but in the other direction: `render/sprites.js` paints a chariot rig or a foot figure in unit-local space, and every caller owns the transform, the ground shadow and the health bar. The battlefield renderer and the shop's preview rig both call the same painter, so a new horse pose or banner appears in both places in one commit, and the unit test measures the rig's real draw calls against `chariotRigBox()` - the box the shop scales into - so a larger silhouette cannot silently start clipping in the preview. The other half of that guard is a source-level test: `renderer.js` may not paint unit art itself. Team colours come from `spritePalette` in the same module, so a preview cannot show the player in a green the battlefield never uses.

What the player bought is drawn, not described: `calculateChariotKit()` in `data/equipment.js` turns the equipment levels into three numbers - the crossbows on the deck (the same count `getPlayerArrowCount()` puts in a volley), the hull scale and the axle blade length - and `drawChariotRig()` takes them as optional arguments, so an enemy row that buys nothing paints the stock rig while a bought one is visibly different. `chariotRigBox(horseCount, kit)` grows the fit-to-box with the hull and the blades, and the measurement test above pins it for every team size. Trees came out of the same pass: the canopy is now pinnate leaf sprays on a forked trunk instead of a solid lobed ball, every tree leans on its own wind and shakes once when rammed (`treeSwayAngle()` is pure, exported and unit-tested to stay inside its declared wind), and the axle blades are the one purchase that changes a rule rather than a pixel - a maxed cap fells a tree at full speed instead of costing hull points. `fellTree()` replaces `campaign.obstacles` rather than splicing it, because the sight index keys on that list's identity and length, and appends the stump to `campaign.stumps`: scenery painted under the bodies, colliding with nothing, and emptied by every `createBattle()`.

The shop dossier is the same rule applied to the camp: `ui/shop-layout.js` holds the pure geometry (the rows and their buy buttons, the radar's five axes and axis labels, the rotated extent the rig is fitted into, the seats around the fire), `ui/shop-dossier.js` paints the five-axis chart with a dashed green ring for the pressed purchase, and `ui/shop-scene.js` draws the team - or, on the crew tab, the night camp - inside whatever rect the layout hands over, reporting back the pixels it actually covered so the fit can be measured instead of eyeballed. Nothing in the page keeps a copy of the team: `ui/shop.js` re-derives the whole frame from the campaign every time it paints, so a preview is only a `pressedId` that the next frame does not find, and the chart, the rig, the camp, the info block and the price all read the same `data/equipment.js` rows the purchase uses, which is why they can never disagree. Only the living take a place on the hull or at the fire; the roster keeps its dead for the ledger. The one browser-shaped concern lives in `ui/canvas-page.js`: the backing store is the element's CSS box times `min(devicePixelRatio, 2)`, a single transform maps the page's 960-wide view units onto it, and the pointer router converts client pixels back into those units before hit-testing the rects the last frame registered. A tap is delivered only to the target that was under the finger when it went down (matched by key, not by rect), so a purchase that re-slices the catalogue between press and release cannot charge for the wrong row, and a finger that travels more than a dozen units is a scroll, not a purchase. The shop is a page, not a camera, so it keeps its own animation frame while the screen is up (`setActive`) and stops it when it closes - a hidden shop neither paints nor schedules anything.
Descriptions are the one thing the shop does not repeat per row. The ledger paints a single info block above its rows: the collision rule while nothing is picked, the pressed row's own copy while a finger is down, and the last tapped or bought item's copy afterwards. That is what keeps a purchase readable, because the pin is an id rather than a paragraph - `ui/shop.js` records `pinnedId` before it runs the purchase, and the very next frame draws that item's copy out of the new state. A tab switch drops the pin, so the block never explains a row that is no longer on screen. The notice strip above the footer is mirrored once into `#shop-live`, an `aria-live` region, because a canvas is opaque to a screen reader and a purchase is exactly the kind of event it has to be able to hear.

Each battlefield narrows the catalog with a `mix`: obstacle entries are shares of the same 46-obstacle target, terrain entries replace the default patch counts, and a kind a mix leaves out never spawns there - that is the whole difference between a flooded crossing and a fortified pass. The obstacle budget is a target rather than a count of tries, because a tree that would touch another tree is dropped: a tree-heavy marsh therefore lands the same number of obstacles as a wall-heavy pass instead of thinning out. Formations spawn through a ground ladder - dry, then uniform, then merely clear, then the old slot-centre rule - and the rung that placed a line is recorded as `groundTier`. The test is `rectHitsObstacle` against the rank box (`formationGroundExtent`), not against slot centres, so a 28px palisade standing between two ranks now rejects the ground; the last rung is pinned at zero spawns.

The player's name is data, not copy. `data/names.js` freezes the two tables shipped in `src/assets/clan/`, `game/identity.js` rolls one row from each with a single weighted draw per table, and `ui/prologue.js` turns the result into five lines: birth, name, the clan's story, the given name's story, ambition - plus a sixth that names the stage the run will be settled on, once `campaign.finalStage` is known. The two story lines are translation keys carried by the rolled rows, so a new name in the table grows its own prologue without new wiring, and the unit test fails if a row ever points at a key no locale defines. The name itself is never translated - only interpolated - which is why `campaign.identity` is rolled once per run and only repainted on a language switch. It is drawn before `createBattle()` re-seeds `campaign.random`, so `?seed=` names the same player without shifting the battle by a single draw, and the last stage is drawn from that same pre-seed moment for the same reason.

Random draws that affect gameplay go through `campaign.random`, a Mulberry32 stream seeded per battle by `src/utils/random.js`, so a battle can be replayed deterministically. Purely cosmetic jitter may still use `Math.random()`. The renderer skips terrain, decals, units, projectiles, and effects outside the camera view. Canvas-drawn art and synthesized tones remain the active rendering/audio paths.
