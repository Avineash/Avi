"""Frame source: Pi Camera (picamera2) or a USB webcam (OpenCV). Frames are BGR arrays."""
from .config import Config


class Camera:
    def __init__(self, cfg: Config):
        self._pc = self._cap = None
        if cfg.camera_backend in ("auto", "picamera2"):
            try:
                from picamera2 import Picamera2

                self._pc = Picamera2()
                self._pc.configure(self._pc.create_video_configuration(
                    main={"size": (1280, 720), "format": "RGB888"}))  # RGB888 is BGR in memory
                self._pc.start()
                return
            except Exception:
                if cfg.camera_backend == "picamera2":
                    raise
        import cv2

        self._cap = cv2.VideoCapture(cfg.camera_index)
        if not self._cap.isOpened():
            raise RuntimeError("no camera found")

    def read(self):
        if self._pc is not None:
            return self._pc.capture_array()
        ok, frame = self._cap.read()
        return frame if ok else None
