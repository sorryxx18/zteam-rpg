# CC0 狀態音樂來源與處理紀錄

## 實際查核的來源（非依記憶判定授權）

- 作品集：**5 chiptunes (action)**，作者 **Juhani Junkala**，OpenGameArt 上傳者 **SubspaceAudio**。
- 來源頁：https://opengameart.org/content/5-chiptunes-action
- 原始下載：https://opengameart.org/sites/default/files/5%20Action%20Chiptunes%20By%20Juhani%20Junkala.zip
- 授權：**CC0 1.0 Universal**，https://creativecommons.org/publicdomain/zero/1.0/
- 實際下載／查核時間：2026-10-20T21:39:50Z（UTC）。下載頁、ZIP、CC0 網頁皆以 `curl -L --fail` 成功取得。
- 來源頁授權欄原文（下載 HTML）：`<div class='license-name'>CC0</div>`，連結 `http://creativecommons.org/publicdomain/zero/1.0/`。
- ZIP 內 `INFO.txt` 作者聲明原文：**“These music tracks have been released under CC0 creative commons license. You can do anything you want with these tunes.”**
- 原 ZIP SHA256：`ea189990c0fb9a700187ccc740eda72400341a082305a163867467d96346460d`。
- 可供本機複核的原始證據：`.qa/music/5-chiptunes-action.html`、`.qa/music/cc0-1.0.html`、`.qa/music/original-INFO.txt`、`.qa/music/original.zip`。`.qa` 為忽略目錄，不是網頁上線所需資產。完整原始 WAV 僅在該目錄，不放進 assets。

## 交付資產

兩首均來自上述明確 CC0 作品集，**不是同一首分裝兩份**：

| 檔案 | 原曲 ZIP 內名稱 | 狀態 | bytes | duration 秒 | loopStart / loopEnd 秒 |
| --- | --- | --- | ---: | ---: | --- |
| explore.wav | Juhani Junkala [Retro Game Music Pack] Level 1.wav | explore；tense 同曲 1.25 倍速 | 935646 | 21.21546485260771 | 0 / 21.21546485260771 |
| result.wav | Juhani Junkala [Retro Game Music Pack] Ending.wav | result，前 10 秒勝利片段，只播一次 | 441044 | 10 | 0 / 10（不循環） |

**音檔合計 1,376,690 bytes，低於 2,000,000 bytes。** 所有交付 WAV 都是無壓縮 PCM16、mono、22050 Hz，無 MP3 encoder delay，Web Audio AudioBuffer 循環邊界為完整 PCM buffer 的 0 與 duration。

### 可重現轉檔／剪接

`.qa/music/process.py` 完整保存處理程式。先下載並解壓 ZIP 至 `.qa/music/original/`，再執行 `python3 .qa/music/process.py`（ffmpeg、Python numpy）。

兩首先用 `ffmpeg -i ORIGINAL.wav -ac 1 -ar 22050 -c:a pcm_s16le MONO.wav` 降採樣、混成單聲道。探索依原曲節奏分析採 181 BPM 的 64 拍／16 小節，四捨五入至 **467801 frames**：

1. 保留原曲首段，取片段結尾後續的 882 frames（40 ms）與片段開頭做**環狀 overlap-add**：首端從尾端後續素材平滑混回原曲開頭，沒有加靜音、沒有以 fade-out 冒充循環。
2. 尾端 64 frames 做 Hermite 平滑接點補償，最後一個 PCM sample 與第一個完全一致（seam jump = 0），並校正斜率。首尾 50 ms RMS 都有訊號，測試防止靜音墊片。
3. 勝利曲取獨立原曲 Ending 的前 **220500 frames**，末 300 ms 淡出；此檔**非循環**，不受探索循環處理影響。

播放狀態切換使用 40 ms gain crossfade；探索→緊張保留樣本相位、改播放速度。背景停止 source 並保存 offset，前景以同狀態／同 offset 恢復，不把結果曲變成探索。背景恢復失敗可查 `getState().error`，顯式 API 的失敗則 reject。短音效 capture/lost/horn 為程式即時合成、無外部音效授權依賴，不建立音訊 context、不繞過使用者 gesture，靜音時不發聲。

## 檔案驗證資料

以下 JSON 是測試讀取的公開資產 manifest；SHA256 由實際輸出檔計算。

```json
{
  "files": {
    "explore.wav": {
      "bytes": 935646,
      "sampleRate": 22050,
      "frames": 467801,
      "duration": 21.21546485260771,
      "loopStart": 0,
      "loopEnd": 21.21546485260771,
      "sha256": "5cad6a50d03bbdf2fb52c45a9cd1efc698ba72f4d3618006202d79677076072f"
    },
    "result.wav": {
      "bytes": 441044,
      "sampleRate": 22050,
      "frames": 220500,
      "duration": 10,
      "loopStart": 0,
      "loopEnd": 10,
      "sha256": "cbf0d2165fa1ce1969e10a01febb859790dcc53645e2f951cb220bf8393779aa"
    }
  }
}
```

## 驗證範圍

`node --test tests/music.test.mjs` 直接讀取真正交付 WAV，檢查 PCM metadata、SHA256、總量與非靜音循環接點；不依賴被忽略的 `.qa`。播放器單元測試使用 **fake AudioContext**，驗證 gesture/resume 順序、狀態、短 crossfade、背景相位、靜音持久化、短音效、非同步競態和錯誤。不宣稱 fake context 能證明真實聽感或 Safari 實機播放，這部分仍需真人在目標瀏覽器聆聽。
