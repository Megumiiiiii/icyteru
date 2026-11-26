package dev.megumii.icyteru;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the Icyteru process (and its WebView WebSocket) alive while the app is
 * in the background. Without this Android may freeze or kill the WebView, so a
 * minimize/resume looks like a disconnected gateway.
 */
public class IcyteruConnectionService extends Service {
    private static final String CHANNEL_ID = "icyteru-connection";
    private static final int NOTIFICATION_ID = 2401;
    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_icyteru)
                .setContentTitle("Icyteru is running")
                .setContentText("Keeping your gateway session connected")
                .setContentIntent(pending)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        startForeground(NOTIFICATION_ID, notification);
        running = true;
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
        stopForeground(true);
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        running = false;
        super.onTimeout(startId, fgsType);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf(startId);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Background connection",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps the gateway WebSocket alive while Icyteru is minimized");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
