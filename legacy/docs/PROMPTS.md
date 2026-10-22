# 《大玩家》AI 生图提示词（PROMPTS.md）

适配：**即梦 / 可灵**（直接粘贴中文版）、**Midjourney**（粘贴英文版，末尾带参数）。
生成后按下表路径放入，**刷新页面即自动生效**（加载器 png 优先，找不到才用同名 svg 占位）：

| 素材 | 放置路径 | 尺寸 | 背景 |
|---|---|---|---|
| 角色头像 ×14 | `client/public/assets/characters/<id>.png` | 1024×1024 | 透明（首选）或纯色 |
| 建筑 ×6 | `client/public/assets/buildings/empty.png`、`lv1.png` … `lv5.png` | 512×512 | 透明 |
| 棋盘背景 | `client/public/assets/board_bg.png` | 2048×2048 | 不透明 |
| Logo | `client/public/assets/logo.png` | 2048×880 | 透明 |
| 骰子皮肤 ×4 | `client/public/assets/dice/<id>.png`（`h100` / `furnace` / `mahjong` / `vram`） | 512×512 | 透明 |

> 即梦/可灵若不能直接出透明底，统一用纯色底 `#00FF00`（绿幕）生成，再用任意抠图工具（如 remove.bg、Photoshop"选择主体"）去底后导出 PNG。
> 角色构图请保持：**头肩半身、正面略侧、头部居中、脸占画面约 45%**，这样与圆形头像裁切和 SVG 占位一致。

---

## 0. 统一风格前缀与负面提示词

**风格前缀（中文）**
```
高清日系动漫风，Q版二头身，大眼睛，圆润可爱，干净利落的深紫色描边，柔和赛璐璐上色带轻微渐变，明亮赛博科技感，霓虹青与品红边缘光，高光细腻，游戏角色立绘，居中构图，
```
**Style prefix (EN)**
```
high-quality anime chibi illustration, 2-head-tall super-deformed, big sparkling eyes, cute rounded shapes, clean dark-purple lineart, soft cel shading with subtle gradients, bright cyberpunk tech vibe, cyan and magenta neon rim light, game character portrait, centered composition,
```
**负面提示词（中文）**
```
写实，照片，真人，3D 写实渲染，恐怖，畸形手指，多余肢体，崩坏五官，文字水印，签名，logo，商标，模糊，低分辨率，噪点，裁切头部，复杂背景，暗沉配色，性感暴露
```
**Negative (EN, Midjourney 用 `--no`)**
```
--no photorealistic, photo, real person likeness, realistic 3d render, horror, deformed hands, extra limbs, distorted face, text, watermark, signature, brand logo, trademark, blurry, lowres, noise, cropped head, cluttered background, dull colors, nsfw
```
**Midjourney 通用参数**：角色 `--ar 1:1 --niji 6 --style expressive --s 200`；建筑/骰子 `--ar 1:1 --niji 6 --s 150`；背景 `--ar 1:1 --v 6.1 --s 250`。

> ⚠️ 真人外号角色一律为**善意戏仿的卡通形象**：提示词里**不写真名、不要求与真人相似**，只描述公开的标志性造型元素（衣着、发型、配饰），并保持可爱化。

---

## 1. 角色（14）

每条 = 风格前缀 + 下列描述 + 背景说明。背景统一：`纯色背景 / solid background`（颜色见括号，或绿幕后抠图）。

### 1.1 `huang` 老黄 · 主色 #76B900
- 中：Q版中年大叔，黑色微翘短发两鬓微灰，自信咧嘴笑，穿标志性黑色皮夹克（皮革高光明显）配黑色T恤，胸前别着一枚绿色显卡芯片徽章，手里比一个"耶"，背后漂浮绿色电路光纹，纯绿色背景 #76B900
- EN: chibi cheerful middle-aged man, short spiky black hair with slightly grey sides, confident toothy grin, iconic black leather jacket with glossy highlights over black t-shirt, small green GPU chip pin on chest, peace sign, floating green circuit glow behind, solid green background #76B900

### 1.2 `altman` 奥特曼 · 主色 #F2C14E
- 中：Q版温和青年，浅棕色蓬松短发，清澈蓝色大眼睛，淡淡微笑，穿灰蓝色圆领针织毛衣，双手捧着一颗发光的小太阳形状 AI 能量球，纯暖金色背景 #F2C14E
- EN: chibi gentle young man, fluffy light-brown short hair, clear big blue eyes, soft smile, grey-blue crew-neck knit sweater, holding a small glowing sun-like AI energy orb, solid warm gold background #F2C14E

### 1.3 `liang` 梁圣 · 主色 #6366F1
- 中：Q版斯文青年工程师，整齐黑色短发侧分刘海，粗黑框方形眼镜，腼腆微笑，白衬衫外搭深藏青外套，手边漂浮一只小蓝鲸和代码窗口，纯靛蓝色背景 #6366F1
- EN: chibi soft-spoken young engineer, neat black short hair with side-swept bangs, thick black square-framed glasses, shy smile, white shirt under dark navy jacket, a tiny blue whale and a code window floating nearby, solid indigo background #6366F1

### 1.4 `musk` 马一龙 · 主色 #E5484D
- 中：Q版自信大叔，深棕色短发额前微微上翘，挑眉坏笑，黑色T恤胸前一枚圆形火箭徽章，背后一枚卡通小火箭拖着火焰升空，旁边一颗小红色星球，纯红色背景 #E5484D
- EN: chibi confident man, short dark-brown hair with a small quiff, raised eyebrow smirk, black t-shirt with a round rocket badge on chest, a cartoon rocket launching with flame behind him, tiny red planet nearby, solid red background #E5484D

### 1.5 `zuck` 小扎 · 主色 #1877F2
- 中：Q版阳光青年，棕色短卷发，蓝灰色大眼睛，憨憨微笑，穿纯蓝色圆领T恤，戴一副科幻VR眼镜推在额头上，手里拿着一块冲浪板形状的发光平板，纯蓝色背景 #1877F2
- EN: chibi friendly young man, short curly brown hair, big blue-grey eyes, slightly awkward cute smile, plain blue crew-neck t-shirt, sci-fi VR goggles pushed up on forehead, holding a glowing surfboard-shaped tablet, solid blue background #1877F2

### 1.6 `dario` 达里奥 · 主色 #C96442
- 中：Q版学者气质青年，浓密深色卷发，张嘴开朗大笑，米白色有领衬衫，手捧一本封面画着橙色星芒的厚书，周围漂浮"安全"盾牌小图标，纯赤陶橙背景 #C96442
- EN: chibi scholarly young man, voluminous dark curly hair, open-mouthed cheerful laugh, off-white collared shirt, holding a thick book with an orange starburst on the cover, small floating safety-shield icons around, solid terracotta background #C96442

### 1.7 `ilya` 伊利亚 · 主色 #EC4899
- 中：Q版温柔学者，光头（头顶有可爱的高光反光），两侧耳上方少量深色短发，眯眼笑成弯月，穿深灰色T恤，双手合拢捧着一颗发光的神经网络水晶，周围漂浮小星光，纯粉色背景 #EC4899
- EN: chibi gentle scholar, bald shiny head with a cute highlight, small dark hair patches above the ears, closed happy crescent eyes smiling, dark grey t-shirt, cupping a glowing neural-network crystal in both hands, little floating sparkles, solid pink background #EC4899

### 1.8 `lecun` 杨立昆 · 主色 #14B8A6
- 中：Q版和蔼教授，银白色向后梳短发，圆框黑色眼镜，温和微笑，深藏青西装外套配浅色衬衫和青绿色领带，肩头站着一只小卷积神经网络形状的机器猫头鹰，纯青绿色背景 #14B8A6
- EN: chibi kind professor, silver-white slicked-back short hair, round black glasses, warm smile, dark navy blazer with light shirt and teal tie, a small robot owl shaped like a convolution grid perched on his shoulder, solid teal background #14B8A6

### 1.9 `deepseek_chan` DeepSeek娘（大肥鱼） · 主色 #4D6BFE
- 中：Q版元气少女，蓝白渐变双马尾（发根宝蓝发梢雪白），蓝色大眼睛，猫咪嘴微笑，头上戴一枚圆滚滚的小蓝鲸发夹（鲸鱼在喷小水柱），蓝白水手服，抱着一只胖乎乎的蓝色鲸鱼玩偶，周围漂浮气泡，纯蓝色背景 #4D6BFE
- EN: chibi energetic anime girl, blue-to-white gradient twin tails (royal blue roots, snow-white tips), big blue eyes, cat-mouth smile, chubby little blue whale hair clip spouting water, blue and white sailor uniform, hugging a plump blue whale plushie, floating bubbles, solid blue background #4D6BFE

### 1.10 `claude_chan` Claude娘 · 主色 #D97757
- 中：Q版知性少女，赭橙色微卷长发，琥珀色眼睛，温柔微笑，发间别着一枚米白色放射星芒发饰和一卷小书卷发夹，赭橙色水手领上衣，怀里抱着一摞书和一支羽毛笔，纯赭橙色背景 #D97757
- EN: chibi thoughtful anime girl, ochre-orange softly wavy long hair, amber eyes, gentle smile, cream radial-starburst hairpin and a tiny scroll hair clip, ochre sailor-collar top, holding a stack of books and a quill pen, solid terracotta-orange background #D97757

### 1.11 `gpt_chan` GPT娘 · 主色 #10A37F
- 中：Q版酷酷少女，黑色齐刘海波波头，翠绿色眼睛，表情淡定带一点小得意，头侧戴一枚绿白相间的六叶花结发饰（六个环交织成花），黑色水手服配绿色领结，身边漂浮对话气泡和闪烁光标，纯墨绿色背景 #10A37F
- EN: chibi cool anime girl, black bob haircut with blunt bangs, emerald green eyes, calm slightly smug expression, green-and-white six-petal interlaced knot hair ornament, black sailor uniform with green bow, floating chat bubbles and a blinking cursor, solid emerald background #10A37F

### 1.12 `gemini_chan` Gemini娘 · 主色 #7B61FF
- 中：Q版梦幻少女，蓝色到紫色渐变的长直发，发梢闪着星光，蓝紫色眼睛，开心张嘴笑，头上两枚四角星芒发饰（蓝紫渐变），蓝紫色水手服，双手各托一颗小星星（双子意象），纯蓝紫渐变背景 #4F8BFF→#B36BFF
- EN: chibi dreamy anime girl, long straight hair with blue-to-purple gradient and starry sparkles at the tips, blue-violet eyes, happy open smile, two four-pointed star hair ornaments in blue-purple gradient, blue-violet sailor uniform, a tiny star floating above each palm (twin motif), solid blue-to-purple gradient background #4F8BFF to #B36BFF

### 1.13 `qwen_chan` 千问娘 · 主色 #A855F7
- 中：Q版古风混搭少女，紫色侧马尾长发，紫罗兰色眼睛，甜甜微笑，发间祥云纹发饰（白色云朵 + 金色发簪），紫色水手领上衣衣角绣着白色云纹，身边飘着几朵小祥云，纯紫色背景 #A855F7
- EN: chibi anime girl with a light oriental touch, long purple hair in a side ponytail, violet eyes, sweet smile, auspicious-cloud hair ornament (white cloud with golden hairpin), purple sailor-collar top embroidered with white cloud patterns, small auspicious clouds floating around, solid purple background #A855F7

### 1.14 `doubao_chan` 豆包娘 · 主色 #22D3EE
- 中：Q版软萌少女，天蓝色头发扎两个圆圆的丸子头，蓝色大眼睛，猫咪嘴，丸子头上别着几颗带笑脸的黄豆子发卡，蓝白水手服，怀里抱着一个圆滚滚的豆包形状抱枕，纯青色背景 #22D3EE
- EN: chibi soft fluffy anime girl, sky-blue hair in two round buns, big blue eyes, cat-mouth smile, several smiling soybean hair clips on the buns, blue and white sailor uniform, hugging a round bun-shaped plush pillow, solid cyan background #22D3EE

---

## 2. 建筑（6，等距 2.5D，透明底）

**建筑前缀（中）**：`Q版等距视角游戏建筑图标，2.5D，圆润可爱，深紫描边，赛博科技感，深蓝紫机身配霓虹青/品红 LED，底部一块菱形发光地块，透明背景，居中，`
**Prefix (EN)**: `cute isometric 2.5D game building icon, chibi proportions, rounded shapes, dark purple outline, cyber tech style, navy-violet body with cyan and magenta neon LEDs, standing on a glowing diamond-shaped ground tile, transparent background, centered,`

| 文件 | 中文 | English |
|---|---|---|
| `empty.png` | 空的菱形地块，虚线施工框，一块霓虹边框小立牌写着"空地"，地上一株小嫩芽 | empty diamond plot with dashed construction outline, a small neon-framed signpost, a tiny green sprout |
| `lv1.png` | 一台 Q 版服务器机柜，正面小屏幕上有一个可爱笑脸，青/绿/品红 LED，顶部风扇 | a single chibi server rack with a cute smiley face on its small front screen, cyan/green/magenta LEDs, fan on top |
| `lv2.png` | 两台一高一低并排的 Q 版服务器机柜，后面那台闪品红灯，之间连着发光数据线 | two chibi server racks side by side, one taller, the back one glowing magenta, connected by a glowing data cable |
| `lv3.png` | 小型数据中心楼，彩色亮窗，门口一盏灯，屋顶小机柜、天线（顶端品红信号灯与信号波纹）和卫星锅 | small data-center building with colorful lit windows, rooftop mini rack, antenna with magenta beacon and signal waves, satellite dish |
| `lv4.png` | 高层数据中心大楼，满墙亮窗，竖向霓虹灯管（青与品红），正面霓虹招牌"v4"，楼顶信标 | tall data-center tower, walls full of lit windows, vertical cyan and magenta neon tubes, neon sign "v4" on the front, rooftop beacon |
| `lv5.png` | 旗舰：三段收分的紫金发光高塔，金色尖顶与星芒，环绕彩虹色光环（青→金→品红），正面金色"AGI"字样，背后竖直光柱与金色光晕，闪闪发光 | flagship: three-tier tapered glowing violet-and-gold tower, golden spire with starburst, rainbow halo ring (cyan→gold→magenta) around it, golden "AGI" lettering on the front, vertical light beam and golden aura behind, sparkles |

---

## 3. 棋盘中央背景（`board_bg.png`）

- 中：俯视角赛博科技底板，深蓝紫径向渐变（中心 #2A1F6E 向四周 #0B0820），细密发光网格线，若干霓虹青/品红/紫色电路走线与节点，左上青色柔光、右下品红柔光，中央一个淡淡的六边形与同心圆环（留给骰子和卡牌），星点微尘，无文字，无人物，2048×2048
- EN: top-down cyber tech board surface, deep navy-violet radial gradient (center #2A1F6E to edges #0B0820), fine glowing grid lines, a few cyan/magenta/violet circuit traces with glowing nodes, soft cyan glow top-left and magenta glow bottom-right, a faint hexagon and concentric rings in the center (space for dice and cards), tiny star dust, no text, no characters `--ar 1:1 --v 6.1 --s 250`

---

## 4. Logo（`logo.png`）

- 中：游戏标题 Logo，三个中文大字"大玩家"，超粗圆润字体，白色到浅青色填充，霓虹渐变描边（青→紫→品红）外发光，下方一个深色胶囊牌写"AI 圈大富翁"，左侧一颗倾斜的霓虹骰子，右侧一枚印着"T"的金币，周围小星芒，透明背景，横版
- EN: game title logo, three bold rounded Chinese characters "大玩家", white-to-light-cyan fill with neon gradient outline (cyan→purple→magenta) and outer glow, a dark pill-shaped plate below reading "AI 圈大富翁", a tilted neon die on the left, a gold coin stamped with "T" on the right, small sparkles, transparent background, horizontal layout `--ar 7:3 --niji 6`
- 提示：AI 生成汉字容易出错，建议只生成图形部分（骰子、金币、光效底板），文字仍用 SVG 叠加；或生成后人工修字。

---

## 5. 骰子皮肤（4，id 需与 `dice.json` 一致）

> 注意：当前 `shared/data/dice.json` 中炼丹炉皮肤 id 为 `alchemy`，美术约定为 `furnace`。两边统一前，文件名以 `dice.json` 实际 id 为准。

**骰子前缀（中）**：`单颗等距视角的圆角正方体游戏骰子，Q版质感，正面可见 1、2、3 点，精致材质，柔和投影，透明背景，居中，`
**Prefix (EN)**: `a single rounded-cube game die in isometric view, cute stylized material, faces showing 1, 2 and 3 pips, soft drop shadow, transparent background, centered,`

| id | 名称建议 | 中文 | English |
|---|---|---|---|
| `h100` | H100 骰 | 石墨黑金属机身，荧光绿色倒角边与电路走线，点数为发绿光的圆点，一面印着小字"H100" | graphite black metal body, neon green beveled edges and circuit traces, glowing green pips, small "H100" engraving on one face |
| `furnace` | 炼丹炉骰 | 古铜色青铜质感，云纹浮雕，点数是发光的橙金色炭火，底部窜出小火苗与火星 | bronze alchemy-furnace material with embossed cloud patterns, glowing orange-gold ember pips, small flames and sparks licking from below |
| `mahjong` | 麻将骰 | 象牙白骨牌质感，下部三分之一是翠绿色底层（像麻将牌背），1 点为大红圆点带同心圆，其他点数蓝/绿 | ivory mahjong-tile material, bottom third in jade green like a tile back, the 1 pip is a large red dot with concentric rings, other pips blue and green |
| `vram` | 显存骰 | 紫色 PCB 电路板材质，黑色显存颗粒，边缘一排金手指，点数为金色圆点，一面印"80GB" | purple PCB material with black memory chips, a row of gold contact fingers along the edge, gold pips, "80GB" printed on one face |

---

## 6. 提交检查清单
- [ ] 文件名与 id 完全一致（小写、下划线），扩展名 `.png`。
- [ ] 角色头部居中、四周留白 ≥ 8%，透明或纯色底。
- [ ] 单张 PNG ≤ 1.5MB（可用 tinypng 压缩），避免手机首屏加载过慢。
- [ ] 真人戏仿角色不出现真名文字、不追求照片级相似、不出现真实公司商标。
