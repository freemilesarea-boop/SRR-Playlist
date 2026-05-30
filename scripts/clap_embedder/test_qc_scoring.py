"""
test_qc_scoring.py — QC 분석 로직 단위 검증 (로컬에서 numpy + pyloudnorm + scipy 만 있으면 실행 가능).

3종 합성 음원으로 점수/등급/위험도를 검증:
  1) GOOD:     -14 LUFS, 정상 마스터, 클리핑 0     → A 또는 B
  2) CLIP:     -8 LUFS, 클리핑 많음, true peak 양수 → CRITICAL
  3) SILENCE:  대부분 무음                          → CRITICAL

실행:
  pip install numpy pyloudnorm scipy
  python test_qc_scoring.py
"""
import numpy as np

# Modal app 의 ClapEmbedder._analyze_qc 와 동일 로직을 추출 (테스트용 카피)
def analyze_qc(audio_array, sr):
    import pyloudnorm as pyln
    from scipy import signal as sps

    if audio_array.ndim == 1:
        mono = audio_array
        stereo_width = 0.0
    else:
        left = audio_array[0]
        right = audio_array[1]
        mid = (left + right) / 2
        side = (left - right) / 2
        mid_rms = float(np.sqrt(np.mean(mid ** 2)))
        side_rms = float(np.sqrt(np.mean(side ** 2)))
        stereo_width = side_rms / (mid_rms + side_rms + 1e-9)
        mono = np.mean(audio_array, axis=0)

    duration = float(len(mono) / sr)

    try:
        meter = pyln.Meter(sr)
        integrated_lufs = float(meter.integrated_loudness(mono))
        if not np.isfinite(integrated_lufs) or integrated_lufs < -80:
            integrated_lufs = -80.0
    except Exception:
        integrated_lufs = None

    try:
        up = sps.resample_poly(mono, 4, 1)
        peak_lin = float(np.max(np.abs(up)))
        true_peak_db = 20 * np.log10(peak_lin + 1e-12)
    except Exception:
        peak_lin = float(np.max(np.abs(mono)))
        true_peak_db = 20 * np.log10(peak_lin + 1e-12)

    clipping_count = int(np.sum(np.abs(mono) >= 0.99))

    win = max(int(sr * 0.05), 1)
    if len(mono) > win:
        squared = mono ** 2
        n_blocks = len(mono) // win
        rms = np.sqrt(np.mean(squared[: n_blocks * win].reshape(n_blocks, win), axis=1))
        noise_rms = float(np.percentile(rms, 10))
        noise_floor_db = 20 * np.log10(noise_rms + 1e-12)
    else:
        noise_floor_db = -60.0

    silence_thresh = 10 ** (-50 / 20.0)
    silence_ratio = float(np.mean(np.abs(mono) < silence_thresh))

    if integrated_lufs is not None:
        dynamic_range = float(true_peak_db - integrated_lufs)
    else:
        dynamic_range = None

    rms_overall = float(np.sqrt(np.mean(mono ** 2)))
    distortion_score = float(np.mean(np.abs(mono) > 4 * rms_overall + 1e-9)) if rms_overall > 0 else 0.0
    distortion_score = min(distortion_score * 5, 1.0)

    issues = []
    score = 100.0

    if integrated_lufs is None:
        score -= 5; issues.append("LOUDNESS_UNKNOWN")
    elif integrated_lufs < -18:
        score -= 15; issues.append("LOUDNESS_LOW")
    elif integrated_lufs > -10:
        score -= 12; issues.append("LOUDNESS_HIGH")
    elif integrated_lufs < -16 or integrated_lufs > -12:
        score -= 5; issues.append("LOUDNESS_OFFTARGET")

    if true_peak_db > 0:
        score -= 20; issues.append("TRUE_PEAK_CLIP")
    elif true_peak_db > -1:
        score -= 8; issues.append("TRUE_PEAK_HOT")

    if clipping_count > 500:
        score -= 25; issues.append("CLIPPING_SEVERE")
    elif clipping_count > 100:
        score -= 12; issues.append("CLIPPING")
    elif clipping_count > 10:
        score -= 4; issues.append("CLIPPING_MINOR")

    if noise_floor_db > -35:
        score -= 15; issues.append("NOISE_HIGH")
    elif noise_floor_db > -45:
        score -= 5; issues.append("NOISE_ELEVATED")

    if silence_ratio > 0.5:
        score -= 30; issues.append("SILENCE_EXCESS")
    elif silence_ratio > 0.3:
        score -= 12; issues.append("SILENCE_HIGH")

    if dynamic_range is not None:
        if dynamic_range < 3:
            score -= 10; issues.append("DR_LOW")
        elif dynamic_range > 25:
            score -= 5; issues.append("DR_HIGH")

    if stereo_width > 0 and stereo_width < 0.05:
        score -= 3; issues.append("STEREO_NARROW")

    if distortion_score > 0.3:
        score -= 10; issues.append("DISTORTION_HIGH")

    if duration < 20:
        score -= 20; issues.append("DURATION_SHORT")
    elif duration > 900:
        score -= 5; issues.append("DURATION_LONG")

    score = max(0.0, min(100.0, score))

    if score >= 85: grade = 'A'
    elif score >= 70: grade = 'B'
    elif score >= 50: grade = 'C'
    else: grade = 'D'

    critical = {'CLIPPING_SEVERE', 'SILENCE_EXCESS', 'TRUE_PEAK_CLIP', 'DURATION_SHORT'}
    high = {'CLIPPING', 'NOISE_HIGH', 'SILENCE_HIGH', 'LOUDNESS_HIGH', 'DISTORTION_HIGH'}
    codes = set(issues)
    if codes & critical:
        risk = 'CRITICAL'
    elif codes & high or score < 50:
        risk = 'HIGH'
    elif score < 70:
        risk = 'MEDIUM'
    else:
        risk = 'LOW'

    return {
        "integrated_lufs": integrated_lufs, "true_peak_db": true_peak_db,
        "dynamic_range": dynamic_range, "stereo_width": stereo_width,
        "noise_floor_db": noise_floor_db, "silence_ratio": silence_ratio,
        "clipping_count": clipping_count, "distortion_score": distortion_score,
        "duration": duration, "qc_score": score, "qc_grade": grade, "risk_level": risk,
        "issues": issues,
    }


def generate_good_track(sr=48000, duration_sec=60):
    """정상 마스터링 — pink noise 비슷한 -14 LUFS 타깃."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), False)
    # 220 Hz + 440 Hz + 660 Hz 합 (음악 비슷한 dynamic 구조)
    sig = 0.3 * np.sin(2 * np.pi * 220 * t) \
        + 0.2 * np.sin(2 * np.pi * 440 * t) \
        + 0.15 * np.sin(2 * np.pi * 660 * t)
    # envelope 변동
    env = 0.7 + 0.3 * np.sin(2 * np.pi * 0.2 * t)
    sig = sig * env
    # -14 LUFS 근처가 되도록 정규화 (rough)
    sig = sig * 0.5
    return sig.astype(np.float32)


def generate_clipped_track(sr=48000, duration_sec=60):
    """클리핑 + 과다 라우드니스."""
    t = np.linspace(0, duration_sec, int(sr * duration_sec), False)
    sig = 1.5 * np.sin(2 * np.pi * 440 * t)
    return np.clip(sig, -1.0, 1.0).astype(np.float32)


def generate_silent_track(sr=48000, duration_sec=60):
    """대부분 무음 — 60% 가 무음."""
    n = int(sr * duration_sec)
    sig = np.zeros(n, dtype=np.float32)
    # 40% 만 음악
    active_len = int(n * 0.4)
    t = np.linspace(0, duration_sec * 0.4, active_len, False)
    sig[:active_len] = 0.3 * np.sin(2 * np.pi * 440 * t)
    return sig


def main():
    SR = 48000
    samples = [
        ("GOOD (정상 마스터)", generate_good_track(SR)),
        ("CLIPPED (1.5×, 클리핑+과다)", generate_clipped_track(SR)),
        ("SILENT (60% 무음)", generate_silent_track(SR)),
    ]
    print(f"{'샘플':<28} {'점수':>6} {'등급':>4} {'위험도':>9} {'LUFS':>7} {'TruePk':>7} {'Clip':>6} {'Silence':>8} {'주요문제'}")
    print("-" * 110)
    for label, audio in samples:
        qc = analyze_qc(audio, SR)
        print(
            f"{label:<28} "
            f"{qc['qc_score']:>6.1f} "
            f"{qc['qc_grade']:>4} "
            f"{qc['risk_level']:>9} "
            f"{(qc['integrated_lufs'] or 0):>7.1f} "
            f"{qc['true_peak_db']:>7.1f} "
            f"{qc['clipping_count']:>6} "
            f"{qc['silence_ratio']*100:>7.1f}% "
            f"{','.join(qc['issues'][:3])}"
        )


if __name__ == "__main__":
    main()
