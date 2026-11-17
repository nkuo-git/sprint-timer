import AVFoundation
import CoreMedia
import ExpoModulesCore

/// 精準時鐘 + 排程鳴槍（iOS）
/// 時基：host time（和 AVCaptureVideoDataOutput 影格 presentationTimeStamp 相同）。
public class PrecisionClockModule: Module {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var gunBuffer: AVAudioPCMBuffer?
  private var prepared = false

  public func definition() -> ModuleDefinition {
    Name("PrecisionClock")

    Function("now") { () -> Double in
      return CMClockGetTime(CMClockGetHostTimeClock()).seconds
    }

    Function("cameraTimestampSource") { () -> String in
      return "host"
    }

    AsyncFunction("prepareAudio") { () throws -> [String: Double] in
      let session = AVAudioSession.sharedInstance()
      // playAndRecord + defaultToSpeaker：和相機同時使用時不會被打斷，且從外放喇叭出聲
      try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .mixWithOthers])
      try session.setPreferredIOBufferDuration(0.005)
      try session.setActive(true)

      if !self.prepared {
        let format = self.engine.outputNode.outputFormat(forBus: 0)
        let sr = format.sampleRate > 0 ? format.sampleRate : 48000
        let monoFormat = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1)!
        self.engine.attach(self.player)
        self.engine.connect(self.player, to: self.engine.mainMixerNode, format: monoFormat)
        self.gunBuffer = PrecisionClockModule.makeGunBuffer(format: monoFormat)
        self.engine.prepare()
        try self.engine.start()
        self.player.play()
        self.prepared = true
      }
      return [
        "sampleRate": self.engine.outputNode.outputFormat(forBus: 0).sampleRate,
        "outputLatency": session.outputLatency,
      ]
    }

    AsyncFunction("playGunAt") { (at: Double) throws -> [String: Any] in
      guard self.prepared, let buffer = self.gunBuffer else {
        throw Exception(name: "NotPrepared", description: "先呼叫 prepareAudio()")
      }
      let session = AVAudioSession.sharedInstance()
      let hostTime = AVAudioTime.hostTime(forSeconds: at)
      let when = AVAudioTime(hostTime: hostTime)
      self.player.scheduleBuffer(buffer, at: when, options: [], completionHandler: nil)
      if !self.player.isPlaying { self.player.play() }
      // AVAudioTime 的 hostTime 是送進輸出裝置的時間，再加上硬體輸出延遲才是喇叭真正發聲
      let latency = session.outputLatency
      return [
        "emittedAt": at + latency,
        "outputLatency": latency,
        "method": "ios-scheduled",
      ]
    }
  }

  /// 合成槍聲：瞬間起音的白噪音 + 指數衰減，約 0.35 秒。起音在第 0 個樣本。
  static func makeGunBuffer(format: AVAudioFormat) -> AVAudioPCMBuffer {
    let sr = format.sampleRate
    let n = AVAudioFrameCount(sr * 0.35)
    let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: n)!
    buf.frameLength = n
    let ch = buf.floatChannelData![0]
    var seed: UInt32 = 12345
    for i in 0..<Int(n) {
      seed = seed &* 1103515245 &+ 12345
      let noise = Float(Int32(bitPattern: seed)) / Float(Int32.max)
      let t = Double(i) / sr
      let env = Float(exp(-t / 0.06))
      ch[i] = max(-1, min(1, noise * env * 0.98))
    }
    return buf
  }
}
