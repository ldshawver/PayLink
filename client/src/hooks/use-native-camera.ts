import { useCallback, useState } from "react";

function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export type CameraSource = "camera" | "photos" | "prompt";

export function useNativeCamera() {
  const [isCapturing, setIsCapturing] = useState(false);

  const capturePhoto = useCallback(async (source: CameraSource = "prompt"): Promise<File | null> => {
    setIsCapturing(true);
    try {
      if (isNativeApp()) {
        const Camera = (window as any).Capacitor?.Plugins?.Camera;
        if (!Camera) return null;

        const CameraSource = {
          Prompt: "PROMPT",
          Camera: "CAMERA",
          Photos: "PHOTOS",
        };
        const CameraResultType = {
          DataUrl: "dataUrl",
          Uri: "uri",
          Base64: "base64",
        };

        const image = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.DataUrl,
          source: source === "camera" ? CameraSource.Camera : source === "photos" ? CameraSource.Photos : CameraSource.Prompt,
          width: 1920,
          height: 1920,
          preserveAspectRatio: true,
        });

        if (image?.dataUrl) {
          const response = await fetch(image.dataUrl);
          const blob = await response.blob();
          const ext = image.format || "jpeg";
          return new File([blob], `photo_${Date.now()}.${ext}`, { type: `image/${ext}` });
        }
        return null;
      }

      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = source === "camera" ? "image/*;capture=camera" : "image/*,.pdf,.doc,.docx";
        if (source === "camera") {
          input.capture = "environment";
        }
        input.onchange = () => {
          const file = input.files?.[0] || null;
          resolve(file);
        };
        input.click();
      });
    } catch (err) {
      console.error("Camera capture failed:", err);
      return null;
    } finally {
      setIsCapturing(false);
    }
  }, []);

  const pickFile = useCallback(async (accept?: string): Promise<File | null> => {
    setIsCapturing(true);
    try {
      if (isNativeApp()) {
        const FilePicker = (window as any).Capacitor?.Plugins?.FilePicker;
        if (FilePicker) {
          const result = await FilePicker.pickFiles({
            types: accept ? [accept] : undefined,
            multiple: false,
          });
          if (result?.files?.length > 0) {
            const f = result.files[0];
            if (f.blob) {
              return new File([f.blob], f.name || `file_${Date.now()}`, { type: f.mimeType });
            }
            if (f.data) {
              const response = await fetch(`data:${f.mimeType};base64,${f.data}`);
              const blob = await response.blob();
              return new File([blob], f.name || `file_${Date.now()}`, { type: f.mimeType });
            }
          }
          return null;
        }
      }

      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept || "image/*,.pdf,.doc,.docx";
        input.onchange = () => {
          const file = input.files?.[0] || null;
          resolve(file);
        };
        input.click();
      });
    } catch (err) {
      console.error("File pick failed:", err);
      return null;
    } finally {
      setIsCapturing(false);
    }
  }, []);

  return {
    isCapturing,
    isNativeApp: isNativeApp(),
    capturePhoto,
    pickFile,
  };
}
