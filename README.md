# 犀牛出任務｜像素街區

繁體中文、俯視像素風的自由探索試玩。以隨附的街道、建物與綠地資料描繪城鎮；目前沒有消防栓、派遣、地址搜尋或搶救功能。僅供遊戲，**不得作為搶救圖資**。

## 本機開啟

不需 npm、建置、外部字體或 CDN。請使用 HTTP 靜態伺服器（模組與相對 JSON 不能直接以 `file://` 開啟）：

```sh
cd /Users/leifhuang/Documents/zteam-rpg
python3 -m http.server 8766 --bind 127.0.0.1
```

開啟 `http://127.0.0.1:8766/`。獨立公開專案為 [sorryxx18/zteam-rpg](https://github.com/sorryxx18/zteam-rpg)，試玩入口為 https://sorryxx18.github.io/zteam-rpg/ 。推送 `main` 後，由 GitHub Actions 執行測試並發布 Pages；發布狀態以 Actions 為準。所有程式、圖像與地圖請求均使用相對路徑，不需伺服器 API。原有兩版遊戲與 Z-TEAM 正式站未修改。

## 操作

- WASD／方向鍵：走動；Shift／空白：按住奔跑。
- 手機右下方向鍵：按住持續走；旁邊「跑」可同時按住。
- 右上「旅人與出發點」：選男隊員、女隊員或犀牛，以及九個分隊。
- `⌂`：回目前分隊的道路出發點；`＋`／`−`：縮放；左下是附近道路小地圖。
- 進入後直接從莊敬分隊開始，不需先通過選角畫面。

## 圖資與角色

`data/base.json` 提供 500 單位地格索引、分隊與地標；`data/c/X_Y.json` 是附近道路、建物輪廓、公園及樹木。座標為東向 x、北向 y，顯示時反轉 y。每次出發先讀附近九格；跨格才更新附近資料，並共用進行中的請求，資料快取最多 25 格。未載入地格先阻擋並讀取，沒有圖資的範圍不允許進入；讀取失敗會提示，重新整理可重試。

建物以原始多邊形阻擋角色腳點，包含邊界與小幅腳邊餘裕；每次位移拆成小步、限制 dt，以避免斜走加速及卡頓穿牆。分隊切換有請求代次保護，等附近資料完成才可動。鍵盤、觸控在放開、取消、失焦及頁面隱藏時清除輸入。

保留 `assets/male.png`、`female.png`、`rhino.png` 的像素圖像。每張 3 欄 × 4 列，格子 64 × 80；方向依序為下、左、右、上，腳底 y=76。角色選擇縮圖使用正面中格。低解析 Canvas 關閉影像平滑；暖色屋頂、陰影、瓦紋和窗戶只是視覺裝飾，不改道路或建物資料。

圖資 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，依原始資料授權使用。本頁不連外讀地圖、分析服務或 API；頁腳 OSM 連結僅在使用者主動點擊時開啟。

## 測試與驗證

```sh
node --test tests/core.test.mjs
node --test tests/*.test.mjs
node --check game.js
```

核心依 TDD 逐項執行 RED → GREEN：

1. 移動向量正規化：初次因功能不存在而失敗，完成後通過。
2. 建物輪廓包含邊界判定：初次失敗，完成後通過。
3. atlas 取格與方向、站立中格：初次失敗，完成後通過。
4. dt 上限、小步碰撞、未知區域阻擋：初次失敗，完成後通過。

本機驗證：核心、角色與圖資契約測試 **8/8 通過**，JavaScript 語法檢查通過。已在真實 Chrome 透過原生鍵盤長按確認移動與放開停止、切換三位角色、逐一確認九分隊出發點可移動；以 390px 手機模擬及原生觸控事件確認方向鍵可移動，並檢查直式與橫式無水平溢出。未觀測到 JavaScript 或 HTTP 錯誤。另先重現再修復縮放按鈕奪取鍵盤焦點的問題，重測通過。這些是瀏覽器與手機尺寸模擬驗證，不代表已在實體手機驗收；低階裝置效能仍需實機試玩。

## 瀏覽器 QA 介面

唯讀快照：

```js
window.__game.getState()
// { ready, x, y, direction, moving, character, station,
//   loadedCells, pendingCells, zoom }
```

另有 `window.__game.renderScene()`，僅重畫。沒有任意傳送或狀態修改入口。請以真實鍵盤長按／觸控按住操作，再讀取位置差、放開後停止、blur／visibility 清鍵、分隊切換等結果；不要透過改座標冒充通過。
