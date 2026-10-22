'use strict';

const { TEST_CREDENTIALS } = require('./data');

/**
 * 构建 Client Bidding (IBiddingAd) 竞价回传与价格读取代码段
 * 严格对齐 cc.admaster.android.proxy.api.IBiddingAd 与 BiddingUtils 强校验规则
 */
function buildBiddingSnippet(language, adVarName = 'ad') {
  if (language === 'kotlin') {
    return `
// === Client Bidding (C2S) 竞价价格获取与竞胜/竞败回传 (cc.admaster.android.proxy.api.IBiddingAd) ===
// 1. 读取返回的明文 eCPM（单位：分/美分，字符串如 "150"）
val ecpmStr: String? = ${adVarName}.responseInfo.ecpmLevel
val bidPriceCents: Int = ecpmStr?.toDoubleOrNull()?.let { if (it > 0) Math.round(it).toInt() else 0 } ?: 0

// 2A. 竞胜通知 notifyWin（必须在校验 !ad.isExpired 且调用 show 之前上报）
// 强校验规则："ecpm" 必须为 > 0 的正整数（严禁带小数点或传 <= 0）
val secondInfo = mapOf<String, Any>(
    "ecpm" to maxOf(1, secondPriceCents),
    "min_to_win" to maxOf(1, secondPriceCents + 1)
)
${adVarName}.notifyWin(secondInfo) { result, message, _ ->
    Log.d("Bidding", "notifyWin result=\$result, msg=\$message")
}

// 2B. 竞败通知 notifyLoss（上报后必须立即调用 destroy() 释放实例）
// 强校验规则："ecpm" 必须为 > 0 的正整数，"reason" 必须为 >= 0 的非负整数（如 102=败给更高出价, 2=超时, 5=过期）
val winInfo = mapOf<String, Any>(
    "ecpm" to maxOf(1, winnerPriceCents),
    "reason" to 102
)
${adVarName}.notifyLoss(winInfo) { result, message, _ ->
    Log.d("Bidding", "notifyLoss result=\$result, msg=\$message")
}
${adVarName}.destroy()`.trim();
  }

  if (language === 'unity-csharp') {
    return `
// === Unity C# AndroidJavaObject Client Bidding 桥接示例 ===
using (var responseInfo = adObject.Call<AndroidJavaObject>("getResponseInfo"))
{
    string ecpmStr = responseInfo?.Call<string>("getEcpmLevel");
    Debug.Log($"[Ads] Bidding ecpmLevel(cents)={ecpmStr}");
}

// 竞胜上报（注意："ecpm" 必须传正整数 java.lang.Integer，严禁带小数点）
using (var secondInfo = new AndroidJavaObject("java.util.HashMap"))
using (var ecpmInt = new AndroidJavaObject("java.lang.Integer", Mathf.Max(1, secondPriceCents)))
{
    secondInfo.Call<AndroidJavaObject>("put", "ecpm", ecpmInt);
    adObject.Call("notifyWin", secondInfo, null);
}`.trim();
  }

  return `
// === Client Bidding (C2S) 竞价价格获取与竞胜/竞败回传 (cc.admaster.android.proxy.api.IBiddingAd) ===
// 1. 读取返回的明文 eCPM（单位：分/美分，字符串如 "150"）
String ecpmStr = ${adVarName}.getResponseInfo().getEcpmLevel();

// 2A. 竞胜通知 notifyWin（必须在校验 !ad.isExpired() 且调用 show 之前上报）
// 强校验规则："ecpm" 必须为 > 0 的正整数（严禁带小数点或传 <= 0，否则 BiddingUtils 校验失败）
Map<String, Object> secondInfo = new HashMap<>();
secondInfo.put("ecpm", Math.max(1, secondPriceCents));
secondInfo.put("min_to_win", Math.max(1, secondPriceCents + 1));
${adVarName}.notifyWin(secondInfo, (result, message, ext) -> {
    Log.d("Bidding", "notifyWin result=" + result + ", msg=" + message);
});

// 2B. 竞败通知 notifyLoss（上报后必须立即调用 destroy() 释放实例）
// 强校验规则："ecpm" 必须为 > 0 的正整数，"reason" 必须为 >= 0 的整数（102=败给更高出价, 2=超时, 5=过期）
Map<String, Object> winInfo = new HashMap<>();
winInfo.put("ecpm", Math.max(1, winnerPriceCents));
winInfo.put("reason", 102);
${adVarName}.notifyLoss(winInfo, (result, message, ext) -> {
    Log.d("Bidding", "notifyLoss result=" + result + ", msg=" + message);
});
${adVarName}.destroy();`.trim();
}

function getTemplate({ ad_format, language = 'java', bidding_mode = 'standard', use_test_credentials = true }) {
  const appId = use_test_credentials ? TEST_CREDENTIALS.app_id : 'YOUR_32_HEX_APP_ID';
  const unitIdMap = {
    rewarded: use_test_credentials ? TEST_CREDENTIALS.placements.rewarded : 'YOUR_REWARDED_UNIT_ID',
    interstitial: use_test_credentials ? TEST_CREDENTIALS.placements.interstitial : 'YOUR_INTERSTITIAL_UNIT_ID',
    native: use_test_credentials ? TEST_CREDENTIALS.placements.native : 'YOUR_NATIVE_UNIT_ID',
    splash: use_test_credentials ? TEST_CREDENTIALS.placements.splash : 'YOUR_SPLASH_UNIT_ID',
    banner: use_test_credentials ? TEST_CREDENTIALS.placements.banner : 'YOUR_BANNER_UNIT_ID'
  };

  const isBidding = bidding_mode === 'client-bidding';

  // 1. SDK 初始化 (init)
  if (ad_format === 'init') {
    let code = '';
    if (language === 'kotlin') {
      code = `
import android.app.Application
import android.util.Log
import cc.admaster.android.proxy.api.AdMaster
import cc.admaster.android.proxy.api.AdMasterSetting
import cc.admaster.android.proxy.api.InitCallback

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // 1. 仅在 Debug 构建开启调试日志，严禁线上常开
        if (BuildConfig.DEBUG) {
            AdMasterSetting.getInstance().setDebugLogEnable(true)
        }
        // 2. 初始化 SDK（必须在 onInitialized 回调触发后再发起首次广告 load）
        AdMaster.initialize(this, "${appId}", object : InitCallback {
            override fun onInitialized() {
                Log.d("Ads", "AdMaster initialized (${bidding_mode})")
                // TODO: 在此处启动核心广告位预加载 (Preload)
            }

            override fun onFailed(code: Int, msg: String?) {
                Log.e("Ads", "AdMaster init failed: code=\$code, msg=\$msg")
            }
        })
    }
}`.trim();
    } else if (language === 'unity-csharp') {
      code = `
using UnityEngine;

public sealed class AdMasterInitBridge : MonoBehaviour
{
    private const string AppId = "${appId}";

    private sealed class InitCallbackProxy : AndroidJavaProxy
    {
        public InitCallbackProxy() : base("cc.admaster.android.proxy.api.InitCallback") { }

        // 注意：AndroidJavaProxy 回调运行在 Android 线程，需通过 UnityMainThreadDispatcher 切回主线程触发预加载
        public void onInitialized()
        {
            Debug.Log("[Ads] AdMaster.onInitialized -> trigger preload on Unity main thread");
        }

        public void onFailed(int code, string msg)
        {
            Debug.LogError($"[Ads] AdMaster.onFailed code={code}, msg={msg}");
        }
    }

    public void InitializeSdk(bool isDebug)
    {
        using var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
        using var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
        using var appContext = activity.Call<AndroidJavaObject>("getApplicationContext");
        using var settingClass = new AndroidJavaClass("cc.admaster.android.proxy.api.AdMasterSetting");
        using var setting = settingClass.CallStatic<AndroidJavaObject>("getInstance");
        setting.Call("setDebugLogEnable", isDebug);

        using var adMasterClass = new AndroidJavaClass("cc.admaster.android.proxy.api.AdMaster");
        adMasterClass.CallStatic("initialize", appContext, AppId, new InitCallbackProxy());
    }
}`.trim();
    } else {
      code = `
import android.app.Application;
import android.util.Log;
import cc.admaster.android.proxy.api.AdMaster;
import cc.admaster.android.proxy.api.AdMasterSetting;
import cc.admaster.android.proxy.api.InitCallback;

public class MyApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        // 1. 仅在 Debug 构建开启日志
        if (BuildConfig.DEBUG) {
            AdMasterSetting.getInstance().setDebugLogEnable(true);
        }
        // 2. 初始化 SDK（严禁在 onInitialized 触发前直接同步调用 load，否则必报 1030003）
        AdMaster.initialize(this, "${appId}", new InitCallback() {
            @Override
            public void onInitialized() {
                Log.d("Ads", "AdMaster initialized");
                // TODO: 在此处启动激励/插屏预加载
            }

            @Override
            public void onFailed(int code, String msg) {
                Log.e("Ads", "AdMaster init failed: code=" + code + ", msg=" + msg);
            }
        });
    }
}`.trim();
    }

    return {
      ad_format,
      language,
      bidding_mode,
      test_app_id: appId,
      imports: [
        'cc.admaster.android.proxy.api.AdMaster',
        'cc.admaster.android.proxy.api.AdMasterSetting',
        'cc.admaster.android.proxy.api.InitCallback'
      ],
      guardrails: [
        '必须在 InitCallback.onInitialized() 触发后才发起首次广告 load(...)，否则会触发 1030003 (ERROR_NOT_INITIALIZED)。',
        'appId 必须为 32 位小写十六进制字符串；若使用多进程，展示广告的子进程需配置 AdActivityController。'
      ],
      code
    };
  }

  // 2. 激励视频 (rewarded -> cc.admaster.android.proxy.api.RewardedAd)
  if (ad_format === 'rewarded') {
    const unitId = unitIdMap.rewarded;
    const biddingBlock = isBidding ? '\n\n' + buildBiddingSnippet(language, 'mRewardedAd') : '';
    let code = '';

    if (language === 'kotlin') {
      code = `
import android.app.Activity
import android.content.Context
import android.util.Log
import cc.admaster.android.proxy.api.AdDismissInfo
import cc.admaster.android.proxy.api.AdError
import cc.admaster.android.proxy.api.AdLoadCallback
import cc.admaster.android.proxy.api.AdRequest
import cc.admaster.android.proxy.api.FullScreenContentCallback
import cc.admaster.android.proxy.api.RewardItem
import cc.admaster.android.proxy.api.RewardedAd

class RewardedAdManager(private val appContext: Context) {
    private var mRewardedAd: RewardedAd? = null
    private var isLoading: Boolean = false
    private val adUnitId = "${unitId}"

    fun preload() {
        // 防并发锁：避免同一广告位重复请求触发 1040005 (ERROR_ALREADY_LOADING)
        if (isLoading) return
        if (mRewardedAd != null && mRewardedAd!!.isReady && !mRewardedAd!!.isExpired) return

        isLoading = true
        val request = AdRequest.Builder().build()
        RewardedAd.load(appContext, adUnitId, request, object : AdLoadCallback<RewardedAd> {
            override fun onAdLoaded(ad: RewardedAd) {
                isLoading = false
                mRewardedAd?.destroy()
                mRewardedAd = ad
                Log.d("Ads", "RewardedAd loaded, ecpm=\${ad.responseInfo.ecpmLevel}")
            }

            override fun onAdFailedToLoad(error: AdError) {
                isLoading = false
                Log.e("Ads", "RewardedAd load failed: code=\${error.code}, msg=\${error.message}")
            }
        })
    }

    fun showIfReady(activity: Activity, onRewardEarned: (RewardItem) -> Unit): Boolean {
        val ad = mRewardedAd
        if (activity.isFinishing || activity.isDestroyed || ad == null) return false
        if (ad.isExpired) {
            ad.destroy()
            mRewardedAd = null
            preload()
            return false
        }
        if (!ad.isReady) return false

        mRewardedAd = null
        ad.setFullScreenContentCallback(object : FullScreenContentCallback {
            override fun onAdShowedFullScreenContent() {
                preload()
            }

            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                ad.destroy()
                preload()
            }

            override fun onAdDismissedFullScreenContent(dismissInfo: AdDismissInfo) {
                ad.destroy()
            }
        })

        // 严禁在 show() 调用点直接发奖，必须在 onUserEarnedReward 回调中发放奖励
        ad.show(activity) { rewardItem ->
            onRewardEarned(rewardItem)
        }
        return true
    }
}${biddingBlock}`.trim();
    } else if (language === 'unity-csharp') {
      code = `
using UnityEngine;

// Unity C# 桥接关键签名核对（包名统一为 cc.admaster.android.proxy.api）：
// - AdLoadCallback<RewardedAd>、FullScreenContentCallback、OnUserEarnedRewardListener 均为 interface，可直接通过 AndroidJavaProxy 代理！
// - RewardedAd.load(Context, String, AdRequest, AdLoadCallback)
// - rewardedAd.show(Activity, OnUserEarnedRewardListener)
// - rewardedAd.isReady() / rewardedAd.isExpired() / rewardedAd.destroy()${biddingBlock}`.trim();
    } else {
      code = `
import android.app.Activity;
import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import cc.admaster.android.proxy.api.AdDismissInfo;
import cc.admaster.android.proxy.api.AdError;
import cc.admaster.android.proxy.api.AdLoadCallback;
import cc.admaster.android.proxy.api.AdRequest;
import cc.admaster.android.proxy.api.FullScreenContentCallback;
import cc.admaster.android.proxy.api.OnUserEarnedRewardListener;
import cc.admaster.android.proxy.api.RewardItem;
import cc.admaster.android.proxy.api.RewardedAd;

public class RewardedAdManager {
    private static final String AD_UNIT_ID = "${unitId}";
    private final Context appContext;
    private RewardedAd mRewardedAd;
    private boolean isLoading = false;

    public RewardedAdManager(@NonNull Context context) {
        this.appContext = context.getApplicationContext();
    }

    public void preload() {
        // 1. 防止同一广告位并发加载触发 1040005 (ERROR_ALREADY_LOADING)
        if (isLoading) return;
        if (mRewardedAd != null && mRewardedAd.isReady() && !mRewardedAd.isExpired()) return;

        isLoading = true;
        AdRequest request = new AdRequest.Builder().build();
        RewardedAd.load(appContext, AD_UNIT_ID, request, new AdLoadCallback<RewardedAd>() {
            @Override
            public void onAdLoaded(@NonNull RewardedAd ad) {
                isLoading = false;
                if (mRewardedAd != null) {
                    mRewardedAd.destroy();
                }
                mRewardedAd = ad;
                Log.d("Ads", "RewardedAd loaded, ecpm=" + ad.getResponseInfo().getEcpmLevel());
            }

            @Override
            public void onAdFailedToLoad(@NonNull AdError error) {
                isLoading = false;
                Log.e("Ads", "RewardedAd failed to load: " + error.getCode() + " - " + error.getMessage());
            }
        });
    }

    public boolean showIfReady(@NonNull Activity activity, @NonNull OnUserEarnedRewardListener rewardListener) {
        if (activity.isFinishing() || activity.isDestroyed() || mRewardedAd == null) {
            return false;
        }
        // 2. 展示前必须校验是否过期 (防止 1040006) 与是否就绪 (防止 3040002)
        if (mRewardedAd.isExpired()) {
            mRewardedAd.destroy();
            mRewardedAd = null;
            preload();
            return false;
        }
        if (!mRewardedAd.isReady()) {
            return false;
        }

        final RewardedAd adToShow = mRewardedAd;
        mRewardedAd = null; // 单次消费

        adToShow.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdShowedFullScreenContent() {
                preload(); // 触发下一条预加载
            }

            @Override
            public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                adToShow.destroy();
                preload();
            }

            @Override
            public void onAdDismissedFullScreenContent(@NonNull AdDismissInfo dismissInfo) {
                adToShow.destroy();
            }
        });

        // 3. 严禁在 show() 调用点直接发奖，必须在 OnUserEarnedRewardListener.onUserEarnedReward 回调中发放奖励
        adToShow.show(activity, rewardListener);
        return true;
    }
}${biddingBlock}`.trim();
    }

    return {
      ad_format,
      language,
      bidding_mode,
      test_app_id: appId,
      test_ad_unit_id: unitId,
      imports: [
        'cc.admaster.android.proxy.api.AdDismissInfo',
        'cc.admaster.android.proxy.api.AdError',
        'cc.admaster.android.proxy.api.AdLoadCallback',
        'cc.admaster.android.proxy.api.AdRequest',
        'cc.admaster.android.proxy.api.FullScreenContentCallback',
        'cc.admaster.android.proxy.api.OnUserEarnedRewardListener',
        'cc.admaster.android.proxy.api.RewardItem',
        'cc.admaster.android.proxy.api.RewardedAd'
      ],
      guardrails: [
        '所有公开 API 类均位于 cc.admaster.android.proxy.api 包下。',
        '发奖逻辑必须在 OnUserEarnedRewardListener.onUserEarnedReward(RewardItem) 中触发，切勿仅凭 onAdDismissedFullScreenContent 发放奖励。',
        '展示前必须校验 ad != null && ad.isReady() && !ad.isExpired()，并在 onAdDismissedFullScreenContent / onAdFailedToShowFullScreenContent 中调用 ad.destroy()。'
      ],
      code
    };
  }

  // 3. 插屏广告 (interstitial -> cc.admaster.android.proxy.api.ExpressInterstitialAd)
  if (ad_format === 'interstitial') {
    const unitId = unitIdMap.interstitial;
    const biddingBlock = isBidding ? '\n\n' + buildBiddingSnippet(language, 'mInterstitialAd') : '';
    let code = '';

    if (language === 'kotlin') {
      code = `
import android.app.Activity
import android.content.Context
import cc.admaster.android.proxy.api.AdDismissInfo
import cc.admaster.android.proxy.api.AdError
import cc.admaster.android.proxy.api.AdLoadCallback
import cc.admaster.android.proxy.api.AdRequest
import cc.admaster.android.proxy.api.ExpressInterstitialAd
import cc.admaster.android.proxy.api.FullScreenContentCallback

class InterstitialAdManager(private val appContext: Context) {
    private var mInterstitialAd: ExpressInterstitialAd? = null
    private var isLoading = false
    private val adUnitId = "${unitId}"

    fun preload() {
        if (isLoading) return
        if (mInterstitialAd != null && mInterstitialAd!!.isReady && !mInterstitialAd!!.isExpired) return

        isLoading = true
        ExpressInterstitialAd.load(appContext, adUnitId, AdRequest.Builder().build(), object : AdLoadCallback<ExpressInterstitialAd> {
            override fun onAdLoaded(ad: ExpressInterstitialAd) {
                isLoading = false
                mInterstitialAd?.destroy()
                mInterstitialAd = ad
            }

            override fun onAdFailedToLoad(error: AdError) {
                isLoading = false
            }
        })
    }

    fun showOrContinue(activity: Activity, onContinueFlow: () -> Unit) {
        val ad = mInterstitialAd
        if (activity.isFinishing || activity.isDestroyed || ad == null) {
            onContinueFlow()
            return
        }
        if (ad.isExpired) {
            ad.destroy()
            mInterstitialAd = null
            preload()
            onContinueFlow()
            return
        }
        if (!ad.isReady) {
            onContinueFlow()
            return
        }

        mInterstitialAd = null
        ad.setFullScreenContentCallback(object : FullScreenContentCallback {
            override fun onAdShowedFullScreenContent() {
                preload()
            }

            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                ad.destroy()
                preload()
                onContinueFlow()
            }

            override fun onAdDismissedFullScreenContent(dismissInfo: AdDismissInfo) {
                ad.destroy()
                onContinueFlow()
            }
        })
        ad.show(activity)
    }
}${biddingBlock}`.trim();
    } else {
      code = `
import android.app.Activity;
import android.content.Context;
import androidx.annotation.NonNull;
import cc.admaster.android.proxy.api.AdDismissInfo;
import cc.admaster.android.proxy.api.AdError;
import cc.admaster.android.proxy.api.AdLoadCallback;
import cc.admaster.android.proxy.api.AdRequest;
import cc.admaster.android.proxy.api.ExpressInterstitialAd;
import cc.admaster.android.proxy.api.FullScreenContentCallback;

public class InterstitialAdManager {
    private static final String AD_UNIT_ID = "${unitId}";
    private final Context appContext;
    private ExpressInterstitialAd mInterstitialAd;
    private boolean isLoading = false;

    public InterstitialAdManager(@NonNull Context context) {
        this.appContext = context.getApplicationContext();
    }

    public void preload() {
        if (isLoading) return;
        if (mInterstitialAd != null && mInterstitialAd.isReady() && !mInterstitialAd.isExpired()) return;

        isLoading = true;
        AdRequest request = new AdRequest.Builder().build();
        ExpressInterstitialAd.load(appContext, AD_UNIT_ID, request, new AdLoadCallback<ExpressInterstitialAd>() {
            @Override
            public void onAdLoaded(@NonNull ExpressInterstitialAd ad) {
                isLoading = false;
                if (mInterstitialAd != null) {
                    mInterstitialAd.destroy();
                }
                mInterstitialAd = ad;
            }

            @Override
            public void onAdFailedToLoad(@NonNull AdError error) {
                isLoading = false;
            }
        });
    }

    public void showOrContinue(@NonNull Activity activity, @NonNull Runnable onContinueFlow) {
        if (activity.isFinishing() || activity.isDestroyed() || mInterstitialAd == null) {
            onContinueFlow.run();
            return;
        }
        if (mInterstitialAd.isExpired()) {
            mInterstitialAd.destroy();
            mInterstitialAd = null;
            preload();
            onContinueFlow.run();
            return;
        }
        if (!mInterstitialAd.isReady()) {
            onContinueFlow.run();
            return;
        }

        final ExpressInterstitialAd adToShow = mInterstitialAd;
        mInterstitialAd = null;

        adToShow.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override
            public void onAdShowedFullScreenContent() {
                preload();
            }

            @Override
            public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                adToShow.destroy();
                preload();
                onContinueFlow.run();
            }

            @Override
            public void onAdDismissedFullScreenContent(@NonNull AdDismissInfo dismissInfo) {
                adToShow.destroy();
                onContinueFlow.run();
            }
        });
        adToShow.show(activity);
    }
}${biddingBlock}`.trim();
    }

    return {
      ad_format,
      language,
      bidding_mode,
      test_app_id: appId,
      test_ad_unit_id: unitId,
      imports: [
        'cc.admaster.android.proxy.api.AdDismissInfo',
        'cc.admaster.android.proxy.api.AdError',
        'cc.admaster.android.proxy.api.AdLoadCallback',
        'cc.admaster.android.proxy.api.AdRequest',
        'cc.admaster.android.proxy.api.ExpressInterstitialAd',
        'cc.admaster.android.proxy.api.FullScreenContentCallback'
      ],
      guardrails: [
        '注意类名：插屏广告公开类名为 ExpressInterstitialAd（位于 cc.admaster.android.proxy.api 包下）。',
        '插屏未就绪或展示失败时必须立即执行 onContinueFlow（不阻塞用户过关或切页），切勿在用户点击按钮时才临时发起同步等待加载。',
        '展示关闭或失败后务必调用 adToShow.destroy() 释放资源。'
      ],
      code
    };
  }

  // 4. 开屏广告 (splash -> cc.admaster.android.proxy.api.SplashAd)
  if (ad_format === 'splash') {
    const unitId = unitIdMap.splash;
    const biddingBlock = isBidding ? '\n\n' + buildBiddingSnippet(language, 'mSplashAd') : '';
    const code = `
import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import java.util.concurrent.atomic.AtomicBoolean;
import cc.admaster.android.proxy.api.AdDismissInfo;
import cc.admaster.android.proxy.api.AdError;
import cc.admaster.android.proxy.api.AdLoadCallback;
import cc.admaster.android.proxy.api.AdRequest;
import cc.admaster.android.proxy.api.FullScreenContentCallback;
import cc.admaster.android.proxy.api.SplashAd;

public class SplashAdHelper {
    private static final String AD_UNIT_ID = "${unitId}";
    private SplashAd mSplashAd;
    // 原子锁：防止超时、展示失败、正常关闭多路回调重复拉起主页面
    private final AtomicBoolean hasNavigated = new AtomicBoolean(false);

    public void loadAndShow(
            @NonNull Activity activity,
            @NonNull ViewGroup splashContainer,
            @NonNull Runnable onEnterMainApp) {

        Runnable safeNavigate = () -> {
            if (hasNavigated.compareAndSet(false, true)) {
                if (mSplashAd != null) {
                    mSplashAd.destroy();
                    mSplashAd = null;
                }
                onEnterMainApp.run();
            }
        };

        AdRequest request = new AdRequest.Builder()
                .setTimeout(5000)
                .addExtra(SplashAd.KEY_IMMERSIVE, "true")
                .build();

        SplashAd.load(activity, AD_UNIT_ID, request, new AdLoadCallback<SplashAd>() {
            @Override
            public void onAdLoaded(@NonNull SplashAd ad) {
                if (activity.isFinishing() || activity.isDestroyed() || hasNavigated.get()) {
                    ad.destroy();
                    return;
                }
                mSplashAd = ad;
                if (ad.isExpired() || !ad.isReady()) {
                    safeNavigate.run();
                    return;
                }
                ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                        safeNavigate.run();
                    }

                    @Override
                    public void onAdDismissedFullScreenContent(@NonNull AdDismissInfo dismissInfo) {
                        safeNavigate.run();
                    }
                });
                // 防止 3040004 (ERROR_SPLASH_CONTAINER_INVISIBLE)：确保容器可见且已挂载
                splashContainer.setVisibility(View.VISIBLE);
                ad.show(splashContainer);
            }

            @Override
            public void onAdFailedToLoad(@NonNull AdError error) {
                safeNavigate.run();
            }
        });
    }
}${biddingBlock}`.trim();

    return {
      ad_format,
      language,
      bidding_mode,
      test_app_id: appId,
      test_ad_unit_id: unitId,
      imports: [
        'cc.admaster.android.proxy.api.AdDismissInfo',
        'cc.admaster.android.proxy.api.AdError',
        'cc.admaster.android.proxy.api.AdLoadCallback',
        'cc.admaster.android.proxy.api.AdRequest',
        'cc.admaster.android.proxy.api.FullScreenContentCallback',
        'cc.admaster.android.proxy.api.SplashAd'
      ],
      guardrails: [
        '注意：使用 SplashAd.load(...) 两步加载时，必须在 onAdLoaded 中显式调用 ad.show(splashContainer)（传入可见的 ViewGroup 容器）；若容器不可见或宽高为 0 会报 3040004 / 3020002。',
        '必须使用 AtomicBoolean 保证 onEnterMainApp 幂等执行，防止超时/失败/关闭重复拉起主页。'
      ],
      code
    };
  }

  // 5. 信息流/原生广告 (native -> cc.admaster.android.proxy.api.NativeAdLoader & NativeAd)
  if (ad_format === 'native') {
    const unitId = unitIdMap.native;
    const biddingBlock = isBidding ? '\n\n' + buildBiddingSnippet(language, 'mCurrentNativeAd') : '';
    const code = `
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import java.util.ArrayList;
import java.util.List;
import cc.admaster.android.proxy.api.AdError;
import cc.admaster.android.proxy.api.AdRequest;
import cc.admaster.android.proxy.api.NativeAd;
import cc.admaster.android.proxy.api.NativeAdInteractionListener;
import cc.admaster.android.proxy.api.NativeAdLoadListener;
import cc.admaster.android.proxy.api.NativeAdLoader;

public class NativeAdExample {
    private static final String AD_UNIT_ID = "${unitId}";
    private NativeAdLoader mLoader;
    private NativeAd mCurrentNativeAd;

    public void loadNativeAd(
            @NonNull Context context,
            @NonNull ViewGroup adContainer,
            @NonNull TextView titleView,
            @NonNull TextView descView,
            @NonNull FrameLayout mediaContainer,
            @NonNull Button ctaButton) {

        mLoader = new NativeAdLoader.Builder(context, AD_UNIT_ID)
                .withAdLoadListener(new NativeAdLoadListener() {
                    @Override
                    public void onNativeAdsLoaded(@NonNull List<NativeAd> ads) {
                        if (ads.isEmpty()) return;
                        if (mCurrentNativeAd != null) {
                            mCurrentNativeAd.destroy();
                        }
                        mCurrentNativeAd = ads.get(0);
                        renderNativeAd(mCurrentNativeAd, adContainer, titleView, descView, mediaContainer, ctaButton);
                    }

                    @Override
                    public void onAdFailedToLoad(@NonNull AdError error) {
                        adContainer.setVisibility(View.GONE);
                    }
                })
                .build();

        mLoader.loadAd(new AdRequest.Builder().build());
    }

    private void renderNativeAd(
            @NonNull NativeAd ad,
            @NonNull ViewGroup adContainer,
            @NonNull TextView titleView,
            @NonNull TextView descView,
            @NonNull FrameLayout mediaContainer,
            @NonNull Button ctaButton) {

        titleView.setText(ad.getTitle());
        descView.setText(ad.getDescription());

        mediaContainer.removeAllViews();
        View mediaView = ad.getAdView();
        if (mediaView != null) {
            mediaContainer.addView(mediaView);
        }

        // 关键：自渲染必须调用 registerViewForInteraction，否则曝光与点击不生效！
        List<View> clickableViews = new ArrayList<>();
        clickableViews.add(titleView);
        clickableViews.add(descView);
        clickableViews.add(mediaContainer);
        clickableViews.add(ctaButton);

        ad.registerViewForInteraction(adContainer, clickableViews, new NativeAdInteractionListener() {
            @Override
            public void onAdImpression(@NonNull NativeAd nativeAd) {}

            @Override
            public void onAdClicked(@NonNull NativeAd nativeAd) {}
        });
    }

    public void destroy() {
        if (mCurrentNativeAd != null) {
            mCurrentNativeAd.destroy();
            mCurrentNativeAd = null;
        }
        if (mLoader != null) {
            mLoader.destroy();
            mLoader = null;
        }
    }
}${biddingBlock}`.trim();

    return {
      ad_format,
      language,
      bidding_mode,
      test_app_id: appId,
      test_ad_unit_id: unitId,
      imports: [
        'cc.admaster.android.proxy.api.AdError',
        'cc.admaster.android.proxy.api.AdRequest',
        'cc.admaster.android.proxy.api.NativeAd',
        'cc.admaster.android.proxy.api.NativeAdInteractionListener',
        'cc.admaster.android.proxy.api.NativeAdLoadListener',
        'cc.admaster.android.proxy.api.NativeAdLoader'
      ],
      guardrails: [
        '自渲染模式必须调用 nativeAd.registerViewForInteraction(container, clickableViews, listener) 绑定容器与点击视图，否则无法触发曝光和点击计费。',
        '列表（RecyclerView）或页面销毁时必须调用 nativeAd.destroy() 与 loader.destroy() 释放资源。'
      ],
      code
    };
  }

  // 6. 横幅广告 (banner -> cc.admaster.android.proxy.api.AdMBannerView / BannerAdLoader)
  const unitId = unitIdMap.banner;
  const biddingBlock = isBidding ? '\n\n' + buildBiddingSnippet(language, 'mBannerAd') : '';
  const code = `
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import cc.admaster.android.proxy.api.AdError;
import cc.admaster.android.proxy.api.AdLoadCallback;
import cc.admaster.android.proxy.api.AdRequest;
import cc.admaster.android.proxy.api.BannerAd;
import cc.admaster.android.proxy.api.BannerAdListener;
import cc.admaster.android.proxy.api.BannerAdLoader;

public class BannerAdHelper {
    private static final String AD_UNIT_ID = "${unitId}";
    private BannerAd mBannerAd;

    public void loadAndAttachBanner(
            @NonNull Context context,
            @NonNull ViewGroup bannerContainer) {

        BannerAdLoader.load(context, AD_UNIT_ID, new AdRequest.Builder().build(), new AdLoadCallback<BannerAd>() {
            @Override
            public void onAdLoaded(@NonNull BannerAd ad) {
                if (mBannerAd != null) {
                    mBannerAd.destroy();
                }
                mBannerAd = ad;
                if (ad.isExpired()) {
                    return;
                }
                ad.setBannerAdListener(new BannerAdListener() {
                    @Override public void onAdLoaded() {}
                    @Override public void onAdFailedToLoad(@NonNull AdError error) {}
                    @Override public void onAdImpression() {}
                    @Override public void onAdClicked() {}
                    @Override
                    public void onAdClosed() {
                        bannerContainer.removeAllViews();
                        bannerContainer.setVisibility(View.GONE);
                        ad.destroy();
                    }
                });

                View bannerView = ad.getView();
                if (bannerView != null) {
                    if (bannerView.getParent() instanceof ViewGroup) {
                        ((ViewGroup) bannerView.getParent()).removeView(bannerView);
                    }
                    bannerContainer.removeAllViews();
                    bannerContainer.setVisibility(View.VISIBLE);
                    bannerContainer.addView(bannerView);
                }
            }

            @Override
            public void onAdFailedToLoad(@NonNull AdError error) {
                bannerContainer.setVisibility(View.GONE);
            }
        });
    }

    public void destroy() {
        if (mBannerAd != null) {
            mBannerAd.destroy();
            mBannerAd = null;
        }
    }
}${biddingBlock}`.trim();

  return {
    ad_format: 'banner',
    language,
    bidding_mode,
    test_app_id: appId,
    test_ad_unit_id: unitId,
    imports: [
      'cc.admaster.android.proxy.api.AdError',
      'cc.admaster.android.proxy.api.AdLoadCallback',
      'cc.admaster.android.proxy.api.AdRequest',
      'cc.admaster.android.proxy.api.BannerAd',
      'cc.admaster.android.proxy.api.BannerAdListener',
      'cc.admaster.android.proxy.api.BannerAdLoader'
    ],
    guardrails: [
      '支持 AdMBannerView（直接挂载视图）与 BannerAdLoader（加载器与视图分离，支持 Client Bidding）两种模式。',
      '在将 bannerAd.getView() 添加到父容器前，先检查其是否已有 Parent 并移除；在宿主页面 onDestroy 时务必调用 destroy()。'
    ],
    code
  };
}

module.exports = {
  getTemplate
};
