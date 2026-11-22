package dev.megumii.icyteru;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves an incoming chat attachment into the phone's public Downloads folder.
 *
 * A WebView anchor with a data: URL and download attribute is not a download on
 * Android; it either opens a blank viewer or does nothing. MediaStore keeps the
 * file visible in Files/Downloads without asking for broad storage access.
 */
@CapacitorPlugin(name = "IcyteruDownload")
public class IcyteruDownloadPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "icyteru-file");
        String dataUrl = call.getString("dataUrl");
        if (dataUrl == null || dataUrl.isEmpty()) {
            call.reject("The file has no data.");
            return;
        }
        int comma = dataUrl.indexOf(',');
        if (comma < 0) {
            call.reject("The file data is invalid.");
            return;
        }
        String meta = dataUrl.substring(0, comma);
        String encoded = dataUrl.substring(comma + 1);
        String mime = "application/octet-stream";
        if (meta.startsWith("data:")) {
            int semi = meta.indexOf(';');
            String type = semi > 5 ? meta.substring(5, semi) : meta.substring(5);
            if (!type.isEmpty()) mime = type;
        }
        if (!meta.contains(";base64")) {
            call.reject("The file is not base64 encoded.");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("The file data is invalid.");
            return;
        }

        String safeName = safeName(name);
        try {
            JSObject result = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? saveWithMediaStore(safeName, mime, bytes)
                    : saveAppDownloads(safeName, bytes);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not save the file.", error);
        }
    }

    private JSObject saveWithMediaStore(String name, String mime, byte[] bytes) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Icyteru");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("Downloads insert failed");
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri)) {
            if (stream == null) throw new IllegalStateException("Downloads stream unavailable");
            stream.write(bytes);
        } catch (Exception error) {
            getContext().getContentResolver().delete(uri, null, null);
            throw error;
        }

        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, done, null, null);

        JSObject result = new JSObject();
        result.put("path", Environment.DIRECTORY_DOWNLOADS + "/Icyteru/" + name);
        result.put("uri", uri.toString());
        return result;
    }

    private JSObject saveAppDownloads(String name, byte[] bytes) throws Exception {
        File folder = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (folder == null) folder = getContext().getFilesDir();
        File target = new File(folder, name);
        try (FileOutputStream stream = new FileOutputStream(target)) {
            stream.write(bytes);
        }
        JSObject result = new JSObject();
        result.put("path", target.getAbsolutePath());
        return result;
    }

    private String safeName(String raw) {
        String name = raw == null ? "icyteru-file" : raw.trim();
        if (name.isEmpty()) name = "icyteru-file";
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (name.equals(".") || name.equals("..")) name = "icyteru-file";
        return name;
    }
}
