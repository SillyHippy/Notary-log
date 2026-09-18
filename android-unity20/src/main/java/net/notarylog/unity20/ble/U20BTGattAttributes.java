/*
 * Copyright (C) 2013 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package net.notarylog.unity20.ble;

import java.util.HashMap;

/**
 * This class includes a small subset of standard GATT attributes for demonstration purposes.
 */
public class U20BTGattAttributes {
    private static HashMap<String, String> attributes = new HashMap();

    public static String SERVICE_SECUGEN_SPP_OVER_BLE = "0000fda0-0000-1000-8000-00805f9b34fb";
    public static String CHARACTERISTIC_READ_NOTIFY = "00002bb1-0000-1000-8000-00805f9b34fb";
    public static String CHARACTERISTIC_WRITE = "00002bb2-0000-1000-8000-00805f9b34fb";
    public static String CLIENT_CHARACTERISTIC_NOTIFY_CONFIG = "00002902-0000-1000-8000-00805f9b34fb";
    public static String SECUGEN_MAC_ADDRESS = "CC:35:5A";

    static {
        // U20BT Services.
        attributes.put(SERVICE_SECUGEN_SPP_OVER_BLE, "SecuGen SPP Over BLE Service");

        // U20BT Characteristics.
        attributes.put(CHARACTERISTIC_READ_NOTIFY, "U20BT BLE Read/Notify");
        attributes.put(CHARACTERISTIC_WRITE, "U20BT BLE Write");
    }

    public static String lookup(String uuid, String defaultName) {
        String name = attributes.get(uuid);
        return name == null ? defaultName : name;
    }
}
