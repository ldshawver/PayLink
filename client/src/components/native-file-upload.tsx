import { useState } from "react";
import { useNativeCamera } from "@/hooks/use-native-camera";
import { Button } from "@/components/ui/button";
import { Camera, FileUp, Image, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NativeFileUploadProps {
  onFileSelected: (file: File) => void;
  accept?: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  disabled?: boolean;
}

export function NativeFileUpload({
  onFileSelected,
  accept,
  label = "Upload",
  variant = "outline",
  size = "default",
  className,
  disabled,
}: NativeFileUploadProps) {
  const { isCapturing, isNativeApp, capturePhoto, pickFile } = useNativeCamera();
  const [showMenu, setShowMenu] = useState(false);

  const handleCameraCapture = async () => {
    const file = await capturePhoto("camera");
    if (file) onFileSelected(file);
    setShowMenu(false);
  };

  const handlePhotoLibrary = async () => {
    const file = await capturePhoto("photos");
    if (file) onFileSelected(file);
    setShowMenu(false);
  };

  const handleFilePick = async () => {
    const file = await pickFile(accept);
    if (file) onFileSelected(file);
    setShowMenu(false);
  };

  const handleWebUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept || "image/*,.pdf,.doc,.docx";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) onFileSelected(file);
    };
    input.click();
  };

  if (isCapturing) {
    return (
      <Button variant={variant} size={size} className={className} disabled>
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Capturing...
      </Button>
    );
  }

  if (isNativeApp) {
    return (
      <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={className}
            disabled={disabled}
            data-testid="button-native-upload"
          >
            <FileUp className="h-4 w-4 mr-2" />
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCameraCapture} data-testid="option-take-photo">
            <Camera className="h-4 w-4 mr-2" />
            Take Photo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePhotoLibrary} data-testid="option-photo-library">
            <Image className="h-4 w-4 mr-2" />
            Photo Library
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleFilePick} data-testid="option-choose-file">
            <FileUp className="h-4 w-4 mr-2" />
            Choose File
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={disabled}
      onClick={handleWebUpload}
      data-testid="button-web-upload"
    >
      <FileUp className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
}
