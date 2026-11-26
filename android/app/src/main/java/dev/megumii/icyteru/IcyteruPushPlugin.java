package dev.megumii.icyteru;

import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "IcyteruPush")
public class IcyteruPushPlugin extends Plugin {
    private static volatile IcyteruPushPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    /**
     * A notification tap while the app is already alive calls
     * MainActivity.onNewIntent, which only writes the pending session to
     * SharedPreferences. Tell the WebView as well so it switches immediately
     * instead of staying on the session that happened to be open.
     */
    static void notifySessionOpened(String sessionId) {
        IcyteruPushPlugin plugin = instance;
        if (plugin == null || sessionId == null || sessionId.isEmpty()) return;
        JSObject data = new JSObject();
        data.put("session_id", sessionId);
        if (plugin.getActivity() != null) {
            plugin.getActivity().runOnUiThread(() -> plugin.notifyListeners("sessionOpened", data));
        } else {
            plugin.notifyListeners("sessionOpened", data);
        }
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                call.reject("Firebase did not return a registration token.");
                return;
            }
            JSObject result = new JSObject();
            result.put("token", task.getResult());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void deleteToken(PluginCall call) {
        FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Firebase could not delete the registration token.");
                return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setConnectionActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        Intent service = new Intent(getContext(), IcyteruConnectionService.class);
        if (active) {
            if (!IcyteruConnectionService.isRunning()) {
                ContextCompat.startForegroundService(getContext(), service);
            }
        } else {
            getContext().stopService(service);
        }
        call.resolve();
    }

    @PluginMethod
    public void consumeSession(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(IcyteruMessagingService.PREFS, android.content.Context.MODE_PRIVATE);
        String sessionId = prefs.getString(IcyteruMessagingService.SESSION_KEY, "");
        prefs.edit().remove(IcyteruMessagingService.SESSION_KEY).apply();
        JSObject result = new JSObject();
        result.put("session_id", sessionId == null ? "" : sessionId);
        call.resolve(result);
    }
}
