package dev.megumii.icyteru;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Background push from the Icyteru gateway plugin. The app itself still uses
 * the WebSocket for chat; this service only wakes the phone with a short
 * preview and opens the app when the notification is tapped.
 */
public class IcyteruMessagingService extends FirebaseMessagingService {
    public static final String PREFS = "icyteru_push";
    public static final String TOKEN_KEY = "fcm_token";
    public static final String SESSION_KEY = "open_session";
    private static final String CHANNEL_ID = "icyteru-messages";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(TOKEN_KEY, token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (MainActivity.isVisible()) return;
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return;

        Map<String, String> data = message.getData();
        String title = data.get("title");
        String body = data.get("body");
        if (message.getNotification() != null) {
            if (title == null || title.isEmpty()) title = message.getNotification().getTitle();
            if (body == null || body.isEmpty()) body = message.getNotification().getBody();
        }
        if (title == null || title.isEmpty()) title = "Icyteru";
        if (body == null) body = "Open Icyteru to continue.";

        String sessionId = data.get("session_id");
        String kind = data.get("kind");
        if (kind == null) kind = "reply";

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (sessionId != null && !sessionId.isEmpty()) {
            intent.putExtra("icyteru_session_id", sessionId);
        }
        PendingIntent pending = PendingIntent.getActivity(
                this,
                (int) (System.currentTimeMillis() & 0x7fffffff),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_icyteru)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(pending);

        createChannel();
        NotificationManagerCompat.from(this).notify(
                (int) (System.currentTimeMillis() & 0x7fffffff),
                builder.build()
        );
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Replies and approvals from Hermes");
        manager.createNotificationChannel(channel);
    }
}
