import { StartMediaButton } from '@livekit/components-react';

export default function AudioPlaybackPrompt() {
  return (
    <div className="vm-audio-playback-prompt" role="status">
      <p>상대방 목소리를 들으려면 아래 버튼을 눌러 주세요.</p>
      <StartMediaButton className="vm-audio-playback-btn" label="음성 재생 허용" />
    </div>
  );
}
