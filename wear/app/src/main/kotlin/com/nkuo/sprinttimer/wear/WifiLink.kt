package com.nkuo.sprinttimer.wear

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.net.Inet4Address

/**
 * 要求系統把 Wi-Fi 打開並保持連線，回報手錶在 Wi-Fi 上的 IP。
 *
 * 手錶平常透過藍牙走配對手機上網，Wi-Fi 是關的；App 明確要求 Wi-Fi 網路時系統才會連上已儲存的 Wi-Fi／熱點。
 * 拿到的 [Network] 要用來綁定 UDP socket，否則封包會被送往預設網路（藍牙代理），到不了終點手機。
 */
class WifiLink(context: Context, private val onChange: (network: Network?, ip: String?) -> Unit) {
  private val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private var current: Network? = null
  private var currentIp: String? = null
  private var started = false

  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) {
      val ip = lp.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
      synchronized(this@WifiLink) {
        if (network == current && ip == currentIp) return
        current = network
        currentIp = ip
      }
      onChange(if (ip != null) network else null, ip)
    }

    override fun onLost(network: Network) {
      synchronized(this@WifiLink) {
        if (network != current) return
        current = null
        currentIp = null
      }
      onChange(null, null)
    }
  }

  @Synchronized
  fun start() {
    if (started) return
    started = true
    val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
    cm.requestNetwork(request, callback)
  }

  @Synchronized
  fun stop() {
    if (!started) return
    started = false
    try {
      cm.unregisterNetworkCallback(callback)
    } catch (e: IllegalArgumentException) {
      // 沒註冊成功
    }
    current = null
    currentIp = null
  }
}
